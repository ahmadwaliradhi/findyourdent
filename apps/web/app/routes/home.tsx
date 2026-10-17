import type { Guidance } from "@findyourdent/contracts";
import type * as React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
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

export default function Home({ actionData: freshActionData, loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  // Back from a Provider page brings the Guidance card back without asking again; a reload rebuilds it.
  const remembered = useEntryMemory("guidance", freshActionData);
  const restored = useGuidanceAcrossReload(remembered);
  const actionData = remembered ?? restored;
  const navigation = useNavigation();
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t("home.headline")}</h1>
        <p className="text-muted-foreground">{t("home.intro")}</p>
      </div>

      <Form method="post" className="flex flex-col gap-4" aria-busy={pending} onSubmit={onSubmit}>
        <p
          role="note"
          className="rounded-md border border-primary/30 bg-secondary px-3 py-2 text-sm text-secondary-foreground"
          data-testid="consent"
        >
          {t("home.consent")}
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="complaintText" className="font-medium">
            {t("home.complaintLabel")}
          </label>
          <Textarea
            // Remounts with each answer, so a voice note's transcript replaces what the box held.
            key={actionData?.complaintText ?? ""}
            id="complaintText"
            name="complaintText"
            required
            maxLength={4000}
            defaultValue={actionData?.complaintText ?? ""}
            placeholder={t("home.complaintPlaceholder")}
            aria-describedby="complaintHint"
          />
          <p id="complaintHint" className="text-xs text-muted-foreground">
            {t("home.complaintHint")}
          </p>
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={pending || recording || !hydrated}
          className="w-full sm:w-auto sm:self-start"
        >
          {pending ? t("home.submitting") : t("home.submit")}
        </Button>
        <VoiceRecorder disabled={pending || !hydrated} onRecorded={onRecorded} onRecordingChange={setRecording} />

        <div aria-live="polite" className="flex flex-col gap-3">
          {actionData?.error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-3 text-sm"
            >
              <p>{t(`errors.${actionData.error}`)}</p>
              <Button type="submit" variant="outline" size="sm" className="self-start" disabled={pending || !hydrated}>
                {t("errors.retry")}
              </Button>
            </div>
          )}
          {actionData?.response && (
            <GuidanceResult response={actionData.response} pending={pending} share={actionData.share} />
          )}
        </div>
      </Form>

      <ImpactCounter counts={loaderData.impact} />

      <Feed filters={loaderData.filters} feed={loaderData.feed} />
    </div>
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
    <section aria-labelledby="feed-title" className="flex flex-col gap-4 border-t pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="feed-title" className="text-xl font-bold">
          {area ? t("feed.titleIn", { area }) : t("feed.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("feed.intro")}</p>
      </div>
      <details className="rounded-md border px-4 py-3" open={query !== ""}>
        <summary className="cursor-pointer font-medium">{t("filters.title")}</summary>
        <div className="pt-4">
          <ListingFiltersForm filters={filters} action="/" />
        </div>
      </details>
      {/* Keyed on the filters, so appended pages reset when the filters change. */}
      <FeedList key={query} query={query} feed={feed} />
    </section>
  );
}

function FeedList({ query, feed }: { query: string; feed: FeedPage }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeedItem[]>(feed.items);
  const [cursor, setCursor] = useState(feed.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6">
        <p className="font-semibold">{t("feed.emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("feed.emptyBody")}</p>
        {/* Testimony posting arrives with its own ticket. */}
        <Button asChild>
          <Link to="/tulis">{t("feed.writeCta")}</Link>
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
      <ul className="flex flex-col gap-4" aria-busy={loading}>
        {items.map((item) => (
          <li key={item.id}>
            <TestimonyCard item={item} />
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("feed.loadError")}
        </p>
      )}
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
