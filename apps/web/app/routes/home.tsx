import type { Guidance } from "@findyourdent/contracts";
import { Clock, Info, MapPin, ShieldCheck } from "lucide-react";
import type * as React from "react";
import { Fragment, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  data,
  Form,
  Link,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { GuidanceResult, shareTokenOf } from "~/components/guidance-result";
import { ImpactCounter } from "~/components/impact-counter";
import { ListingFiltersForm } from "~/components/listing-filters-form";
import { TestimonyCard } from "~/components/testimony-card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ErrorNotice } from "~/components/ui/error-notice";
import { Field, FieldError } from "~/components/ui/field";
import { VoiceRecorder } from "~/components/voice-recorder";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { APP_CHECK_FIELD } from "~/lib/app-check";
import { keepAcrossReload, recallAcrossReload, rememberEntry, useEntryMemory } from "~/lib/entry-memory";
import type { FeedItem, FeedPage } from "~/lib/feed";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { type ListingFilters, listingFiltersToParams, parseListingFilters } from "~/lib/listing-filters";
import { provinceName, regionLabel } from "~/lib/regions";
import { openGraphMeta } from "~/lib/seo";
import { loadFeedPage } from "~/server/feed.server";
import { guidanceBodyTooLarge, requestGuidance } from "~/server/guidance.server";
import { readImpactCounter } from "~/server/impact.server";
import { guidanceRoute, protectPaidRequest, setRetryAfter } from "~/server/protection.server";
import { getOrCreateSessionId } from "~/server/session.server";
import { sharePath } from "~/server/share.server";
import type { Route } from "./+types/home";

/** "Kota Bandung, Jawa Barat" or "Jawa Barat" when the feed is filtered by area. */
function filterArea(filters: ListingFilters): string | null {
  if (filters.provinceCode && filters.regencyCode) {
    return regionLabel({ provinceCode: filters.provinceCode, regencyCode: filters.regencyCode });
  }
  return filters.provinceCode ? provinceName(filters.provinceCode) : null;
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const filters = loaderData?.filters;
  const area = filters ? filterArea(filters) : null;
  const url = loaderData?.url;
  const preview = (title: string, description: string) => (url ? openGraphMeta({ title, description, url }) : []);
  if (!filters || !area) {
    return [
      { title: t("meta.title") },
      { name: "description", content: t("meta.description") },
      ...preview(t("meta.title"), t("meta.description")),
    ];
  }
  // Province and kota views are the indexable ones; finer combinations are left out of search.
  const fineGrained = filters.districtCode || filters.procedureCode || filters.providerType || filters.verifiedOnly;
  return [
    { title: t("feed.metaTitle", { area }) },
    { name: "description", content: t("feed.metaDescription", { area }) },
    ...(fineGrained ? [{ name: "robots", content: "noindex, follow" }] : []),
    ...preview(t("feed.metaTitle", { area }), t("feed.metaDescription", { area })),
  ];
}

/** Server-renders the first feed page for the filters in the URL; later pages come from /api/feed. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const filters = parseListingFilters(url.searchParams);
  const [feed, impact] = await Promise.all([
    context.firestore
      ? loadFeedPage(context.firestore, filters)
      : Promise.resolve<FeedPage>({ items: [], nextCursor: null }),
    readImpactCounter(context.firestore),
  ]);
  return { filters, feed, impact, url: `${url.origin}${url.pathname}${url.search}` };
}

/** A Guidance submit changes nothing in the feed, so it does not re-read it. */
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return formMethod?.toUpperCase() === "POST" ? false : defaultShouldRevalidate;
}

/** Form submission from the home page; the browser never calls the agent itself. */
export async function action({ request, context }: Route.ActionArgs) {
  if (guidanceBodyTooLarge(request)) {
    // The body is left unread, so the connection cannot carry another request.
    return data(
      { complaintText: "", error: "audio_too_large" as const, response: null, share: null },
      { status: 413, headers: { Connection: "close" } },
    );
  }
  const form = await request.formData();
  const complaintText = form.get("complaintText");
  // A voice note from the record button; never stored, only forwarded to the agent.
  const audio = form.get("audio");
  const followUpQuestion = form.get("followUpQuestion");
  const followUpAnswer = form.get("followUpAnswer");
  // The complaint is echoed back only so the Patient's own form keeps it; it is never stored.
  const echoed = typeof complaintText === "string" ? complaintText : "";

  const [language, session] = await Promise.all([detectLanguage(request), getOrCreateSessionId(request)]);
  const headers = new Headers();
  if (session.setCookie) headers.append("Set-Cookie", session.setCookie);

  const protection = await protectPaidRequest(context, {
    request,
    route: guidanceRoute(followUpAnswer, session.setCookie !== null),
    sessionId: session.sessionId,
    formToken: form.get(APP_CHECK_FIELD),
  });
  if (!protection.ok) {
    setRetryAfter(headers, protection);
    return data(
      { complaintText: echoed, error: protection.error, response: null, share: null },
      { status: protection.status, headers },
    );
  }

  const outcome = await requestGuidance(context, {
    sessionId: session.sessionId,
    language,
    complaintText,
    audio,
    followUpQuestion,
    followUpAnswer,
  });

  if (!outcome.ok) {
    return data(
      { complaintText: echoed, error: outcome.error, response: null, share: null },
      { status: outcome.status, headers },
    );
  }
  const { response } = outcome;
  // Built from the Guidance object alone: the link never carries the complaint.
  const share =
    response.kind === "guidance"
      ? { path: sharePath(response.guidance, context.config.shareLinkSecret), origin: new URL(request.url).origin }
      : null;
  // What the agent heard fills the complaint box, so the Patient can fix a misheard word and send it as text.
  return data({ complaintText: response.transcript ?? echoed, error: null, response, share }, { headers });
}

export default function Home({ actionData: routeActionData, loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  // The router hands over the answer while it still revalidates the loaders, before the new
  // history entry exists. Shown then, a tap on the card (opening the Shortlist) would belong
  // to the old entry and be undone when the new one lands, and the answer would be remembered
  // for the old entry. So the answer shows once its own entry is current.
  const revalidatingAfterSubmit = navigation.state === "loading" && navigation.formAction === "/?index";
  const freshActionData = revalidatingAfterSubmit ? undefined : routeActionData;
  // Back from a Provider page brings the Guidance card back without asking again; a reload rebuilds it.
  const remembered = useEntryMemory("guidance", freshActionData);
  const restored = useGuidanceAcrossReload(remembered);
  const actionData = remembered ?? restored;
  // Fetching the App Check token counts as pending too, so a second tap cannot send a second request.
  const [preparing, setPreparing] = useState(false);
  // A typed submit mid-recording would race the voice note, so it waits.
  const [recording, setRecording] = useState(false);
  const pending = preparing || (navigation.state === "submitting" && navigation.formAction === "/?index");
  const submit = useSubmit();
  const firebase = useFirebaseConfig();
  // Until the page hydrates, a submit would skip onSubmit and post without an App Check token.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Guidance can call Gemini, so the server wants an App Check token with every submit.
  const send = (formData: FormData, encType: "application/x-www-form-urlencoded" | "multipart/form-data") => {
    setPreparing(true);
    void getAppCheckToken(firebase)
      .catch(() => "")
      .then((token) => {
        formData.set(APP_CHECK_FIELD, token);
        setPreparing(false);
        void submit(formData, { method: "post", encType });
      });
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    send(
      new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter),
      "application/x-www-form-urlencoded",
    );
  };

  // The voice note alone: the agent hears it, and what it heard comes back to correct.
  const onRecorded = (audio: Blob) => {
    if (pending) return;
    const formData = new FormData();
    formData.set("audio", audio, "voice-note");
    send(formData, "multipart/form-data");
  };

  return (
    <div className="flex flex-col gap-10 desktop:gap-14">
      <Form method="post" className="flex flex-col" aria-busy={pending} onSubmit={onSubmit}>
        <div className="grid gap-6 desktop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] desktop:items-start desktop:gap-10">
          <div className="flex flex-col gap-6 desktop:pt-2">
            <div className="flex flex-col gap-4">
              <Badge variant="brand">{t("home.badge")}</Badge>
              <h1 className="text-[34px] leading-[38px] font-bold tracking-[-.02em] desktop:text-[52px] desktop:leading-[56px]">
                {t("home.headline")}
              </h1>
              <p className="max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground">{t("home.intro")}</p>
            </div>
            <Benefits />
          </div>

          {/* The complaint box and the consent line lead the page on a phone too. */}
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-md desktop:p-6">
            <p role="note" className="flex items-start gap-2.5 rounded-md bg-muted px-4 py-3" data-testid="consent">
              <Info aria-hidden="true" strokeWidth={1.75} className="mt-1 size-4 shrink-0 text-muted-foreground" />
              <span>{t("home.consent")}</span>
            </p>
            <Field
              // Remounts with each answer, so a voice note's transcript replaces what the box held.
              key={actionData?.complaintText ?? ""}
              id="complaintText"
              name="complaintText"
              label={t("home.complaintLabel")}
              hint={t("home.complaintHint")}
              required
              maxLength={4000}
              rows={5}
              defaultValue={actionData?.complaintText ?? ""}
              placeholder={t("home.complaintPlaceholder")}
              className="[&>label]:text-lg [&>label]:leading-6 [&>label]:font-[650]"
            />
            <Button type="submit" size="lg" block disabled={pending || recording || !hydrated}>
              {pending ? t("home.submitting") : t("home.submit")}
            </Button>
            {/* Grouped so the live region, empty until an error, adds no gap of its own. */}
            <div className="flex flex-col">
              <VoiceRecorder disabled={pending || !hydrated} onRecorded={onRecorded} onRecordingChange={setRecording} />
              <div aria-live="polite">
                {actionData?.error && (
                  <ErrorNotice role="alert" className="mt-4">
                    <p>{t(`errors.${actionData.error}`)}</p>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={pending || !hydrated}
                    >
                      {t("errors.retry")}
                    </Button>
                  </ErrorNotice>
                )}
              </div>
            </div>
          </div>
        </div>

        <div aria-live="polite">
          {actionData?.response && (
            <div className="pt-10">
              <GuidanceResult response={actionData.response} pending={pending} share={actionData.share} />
            </div>
          )}
        </div>
      </Form>

      <ImpactCounter counts={loaderData.impact} />

      <Feed filters={loaderData.filters} feed={loaderData.feed} />
    </div>
  );
}

const BENEFITS = [
  { key: "urgency", icon: Clock },
  { key: "cost", icon: ShieldCheck },
  { key: "nearby", icon: MapPin },
] as const;

/** What the Guidance gives, beside the complaint box on desktop. Left out on a phone, so the box comes first. */
function Benefits() {
  const { t } = useTranslation();
  return (
    <ul aria-label={t("home.benefits.label")} className="hidden max-w-[520px] flex-col gap-3 desktop:flex">
      {BENEFITS.map(({ key, icon: Icon }) => (
        <li key={key} className="flex items-start gap-3">
          <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            <Trans i18nKey={`home.benefits.${key}`} components={{ b: <b className="font-semibold" /> }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

type HomeActionData = NonNullable<Route.ComponentProps["actionData"]>;

/**
 * Keeps the signed Guidance token of this history entry in sessionStorage and, when a
 * reload left the in-tab memory empty, rebuilds the card from it on the server. No
 * Gemini call, and the complaint box starts empty: the complaint is never stored.
 */
function useGuidanceAcrossReload(shown: HomeActionData | undefined): HomeActionData | undefined {
  const { key: entryKey } = useLocation();
  const [restored, setRestored] = useState<{ entryKey: string; data: HomeActionData } | null>(null);
  const token = shown?.share ? shareTokenOf(shown.share.path) : null;

  useEffect(() => {
    if (token) keepAcrossReload(entryKey, "guidanceToken", token);
  }, [entryKey, token]);

  useEffect(() => {
    if (shown) return;
    const kept = recallAcrossReload(entryKey, "guidanceToken");
    if (!kept) return;
    let live = true;
    void fetch("/api/guidance-card", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: kept }),
    })
      .then(async (response) => {
        // A token signed with an older secret no longer opens; forget it.
        if (response.status === 404) keepAcrossReload(entryKey, "guidanceToken", null);
        if (!response.ok) return;
        const { guidance } = (await response.json()) as { guidance: Guidance };
        const data: HomeActionData = {
          complaintText: "",
          error: null,
          response: { kind: "guidance", guidance },
          share: { path: `/panduan/${kept}`, origin: window.location.origin },
        };
        rememberEntry(entryKey, "guidance", data);
        if (live) setRestored({ entryKey, data });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [entryKey, shown]);

  return restored?.entryKey === entryKey ? restored.data : undefined;
}

function Feed({ filters, feed }: { filters: ListingFilters; feed: FeedPage }) {
  const { t } = useTranslation();
  const area = filterArea(filters);
  const query = listingFiltersToParams(filters).toString();

  return (
    <section aria-labelledby="feed-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2
            id="feed-title"
            className="text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-4xl desktop:leading-[42px]"
          >
            {area ? t("feed.titleIn", { area }) : t("feed.title")}
          </h2>
          <p className="max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground">{t("feed.intro")}</p>
        </div>
        <Button asChild variant="ghost" className="hidden desktop:inline-flex">
          <Link to="/direktori">{t("feed.seeDirectory")}</Link>
        </Button>
      </div>
      <details className="rounded-lg border bg-card px-5 py-3" open={query !== ""}>
        <summary className="flex min-h-touch cursor-pointer items-center font-semibold">{t("filters.title")}</summary>
        <div className="pt-4 pb-2">
          <ListingFiltersForm filters={filters} action="/" />
        </div>
      </details>
      {/* Keyed on the filters, so appended pages reset when the filters change. */}
      <FeedList key={query} query={query} feed={feed} />
    </section>
  );
}

/** "Pernah ke dokter gigi?": the way to write a Testimony, among the Testimonies themselves. */
function WritePrompt() {
  const { t } = useTranslation();
  return (
    <aside
      aria-labelledby="write-prompt-title"
      className="flex flex-col gap-3 rounded-lg bg-secondary p-6 text-secondary-foreground"
    >
      <h3 id="write-prompt-title" className="text-lg leading-6 font-[650]">
        {t("feed.writeTitle")}
      </h3>
      <p>{t("feed.writeBody")}</p>
      <Button asChild className="self-start">
        <Link to="/ceritakan">{t("testimonyForm.entryCta")}</Link>
      </Button>
    </aside>
  );
}

/** The write prompt comes after this many Testimonies, or after the last when there are fewer. */
const WRITE_PROMPT_AFTER = 3;

function FeedList({ query, feed }: { query: string; feed: FeedPage }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeedItem[]>(feed.items);
  const [cursor, setCursor] = useState(feed.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-strong bg-card px-5 py-6">
        <p className="font-semibold">{t("feed.emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("feed.emptyBody")}</p>
        <Button asChild>
          <Link to="/ceritakan">{t("feed.writeCta")}</Link>
        </Button>
      </div>
    );
  }

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", cursor);
      const response = await fetch(`/api/feed?${params}`);
      if (!response.ok) throw new Error(`feed ${response.status}`);
      const page = (await response.json()) as FeedPage;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="grid items-start gap-4 desktop:grid-cols-2 desktop:gap-5" aria-busy={loading}>
        {items.map((item, index) => (
          <Fragment key={item.id}>
            <li>
              <TestimonyCard item={item} />
            </li>
            {index === Math.min(WRITE_PROMPT_AFTER, items.length) - 1 && (
              <li>
                <WritePrompt />
              </li>
            )}
          </Fragment>
        ))}
      </ul>
      {failed && <FieldError role="alert">{t("feed.loadError")}</FieldError>}
      {cursor && (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? t("feed.loading") : t("feed.loadMore")}
        </Button>
      )}
    </>
  );
}
