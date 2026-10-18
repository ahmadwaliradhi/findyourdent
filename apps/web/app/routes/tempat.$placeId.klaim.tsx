import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { ProviderType, RegionRef } from "@findyourdent/contracts/firestore";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Link, useRevalidator } from "react-router";
import { RegionFields } from "~/components/region-fields";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ErrorNotice } from "~/components/ui/error-notice";
import { FieldError, fieldClassName } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { getI18n, type Language } from "~/i18n/config";
import {
  CLAIM_CHECK_WORKING_DAYS,
  CLAIM_FIELDS,
  CLAIM_ROLES,
  type ClaimSubmission,
  OWNER_LIMITS,
  type OwnerContentResponse,
  type OwnerFactsSubmission,
  PERMIT_MIME_TYPES,
  PROVIDER_TYPES,
} from "~/lib/claims";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatVisitMonth } from "~/lib/format";
import { sendOwnerRequest as send } from "~/lib/owner-request";
import { providerPath } from "~/lib/paths";
import { SITE_NAME } from "~/lib/seo";
import { type ClaimPageData, loadClaimPage, type OwnerTestimony } from "~/server/claims.server";
import { isPlaceId } from "~/server/provider.server";
import type { Route } from "./+types/tempat.$placeId.klaim";

/**
 * Claim a Provider page (spec 05): sign in with Google, upload the SIP or practice
 * permit, then wait for the team's check. The approved claimant manages the page's
 * facts and replies to Testimonies here. No promotion tools, and no way to delete or
 * hide a Testimony: reporting one stays on the Provider page, like for everyone.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isPlaceId(params.placeId)) throw data(null, { status: 404 });
  return loadClaimPage(context, request, params.placeId);
}

export function meta({ matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: `${t("claim.title")} | ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export default function ClaimPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const page = loaderData;
  const backTo = providerPath(page.placeId);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to={backTo} className="text-sm underline">
          {t("claim.back")}
        </Link>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
          {page.owner ? t("claim.manageTitle") : t("claim.title")}
        </h1>
        {page.providerName && <p className="text-muted-foreground">{page.providerName}</p>}
      </header>
      <ClaimBody page={page} />
    </div>
  );
}

function ClaimBody({ page }: { page: ClaimPageData }) {
  const { t } = useTranslation();
  if (page.owner) return <OwnerTools page={page} />;
  if (!page.signedIn) {
    const signIn = `/signin?redirectTo=${encodeURIComponent(`${providerPath(page.placeId)}/klaim`)}`;
    return (
      <section className="flex flex-col gap-3">
        <Explainer />
        <Button asChild className="self-start">
          <a href={signIn}>{t("claim.signIn")}</a>
        </Button>
      </section>
    );
  }
  const claim = page.myClaim;
  if (claim?.status === "submitted") {
    return (
      <p role="status" className="rounded-md border bg-muted p-4">
        {t("claim.status.submitted", { days: CLAIM_CHECK_WORKING_DAYS })}
      </p>
    );
  }
  if (page.claimedByOther || (page.claimed && claim?.status !== "approved")) {
    return <p className="rounded-md border bg-muted p-4">{t("claim.status.claimedByOther")}</p>;
  }
  return (
    <section className="flex flex-col gap-4">
      {claim?.status === "rejected" && (
        <ErrorNotice role="alert" className="p-4 text-base">
          <p>{t("claim.status.rejected", { reason: claim.rejectionReason ?? "" })}</p>
        </ErrorNotice>
      )}
      {claim?.status === "revoked" && <p className="rounded-md border p-4">{t("claim.status.revoked")}</p>}
      <Explainer />
      <ClaimForm placeId={page.placeId} listed={page.providerName !== null} />
    </section>
  );
}

function Explainer() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{t("claim.intro")}</p>
      <ol className="list-decimal pl-5">
        <li>{t("claim.steps.signIn")}</li>
        <li>{t("claim.steps.permit")}</li>
        <li>{t("claim.steps.check", { days: CLAIM_CHECK_WORKING_DAYS })}</li>
      </ol>
      <p className="text-muted-foreground">{t("claim.ethics")}</p>
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "tel";
  required?: boolean;
  maxLength: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={id}
        type={props.type ?? "text"}
        required={props.required}
        maxLength={props.maxLength}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={fieldClassName}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      {props.hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
    </div>
  );
}

type Sending =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

function Feedback({ state }: { state: Sending }) {
  if (state.phase === "done") return <p role="status">{state.message}</p>;
  if (state.phase === "error") {
    return (
      <FieldError role="alert" className="text-base">
        {state.message}
      </FieldError>
    );
  }
  return null;
}

function ClaimForm({ placeId, listed }: { placeId: string; listed: boolean }) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const revalidator = useRevalidator();
  const id = useId();
  const [role, setRole] = useState<ClaimSubmission["role"]>("owner");
  const [contactPhone, setContactPhone] = useState("");
  const [providerName, setProviderName] = useState("");
  const [region, setRegion] = useState<RegionRef>({ provinceCode: "", regencyCode: "" });
  const [permit, setPermit] = useState<File | null>(null);
  const [state, setState] = useState<Sending>({ phase: "idle" });
  const sending = state.phase === "sending";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!permit) return;
    setState({ phase: "sending" });
    const claim: ClaimSubmission = {
      role,
      contactPhone,
      ...(listed ? {} : { providerName, region }),
    };
    const form = new FormData();
    form.set(CLAIM_FIELDS.json, JSON.stringify(claim));
    form.set(CLAIM_FIELDS.permit, permit);
    const result = await send(firebase, `/api/providers/${encodeURIComponent(placeId)}/claims`, form);
    if (result.ok) {
      setState({ phase: "done", message: (result.body as { message: string }).message });
      await revalidator.revalidate();
    } else {
      setState({ phase: "error", message: result.message ?? t("claim.failed") });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-role`} className="text-sm font-medium">
          {t("claim.role")}
        </label>
        <select
          id={`${id}-role`}
          className={fieldClassName}
          value={role}
          disabled={sending}
          onChange={(event) => setRole(event.target.value as ClaimSubmission["role"])}
        >
          {CLAIM_ROLES.map((value) => (
            <option key={value} value={value}>
              {t(`claim.roles.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={t("claim.contactPhone")}
        hint={t("claim.contactPhoneHint")}
        type="tel"
        required
        maxLength={OWNER_LIMITS.phoneMax}
        value={contactPhone}
        onChange={setContactPhone}
        disabled={sending}
      />
      {!listed && (
        <>
          <TextField
            label={t("claim.facts.name")}
            required
            maxLength={OWNER_LIMITS.nameMax}
            value={providerName}
            onChange={setProviderName}
            disabled={sending}
          />
          <RegionFields mode="pick" required value={region} onChange={setRegion} disabled={sending} />
        </>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-permit`} className="text-sm font-medium">
          {t("claim.permit")}
        </label>
        <input
          id={`${id}-permit`}
          type="file"
          required
          accept={PERMIT_MIME_TYPES.join(",")}
          disabled={sending}
          onChange={(event) => setPermit(event.target.files?.[0] ?? null)}
          aria-describedby={`${id}-permit-hint`}
          className="text-sm"
        />
        <p id={`${id}-permit-hint`} className="text-xs text-muted-foreground">
          {t("claim.permitHint")}
        </p>
      </div>
      <Button type="submit" className="self-start" disabled={sending || !permit}>
        {sending ? t("claim.sending") : t("claim.submit")}
      </Button>
      <div aria-live="polite">
        <Feedback state={state} />
      </div>
    </form>
  );
}

function OwnerTools({ page }: { page: ClaimPageData }) {
  const { t } = useTranslation();
  const owner = page.owner as NonNullable<ClaimPageData["owner"]>;
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">{t("claim.ownerIntro")}</p>
      <section className="flex flex-col items-start gap-2 rounded-md border px-4 py-3">
        <p className="text-sm text-muted-foreground">{t("priceList.intro")}</p>
        <Button asChild size="sm">
          <Link to={`${providerPath(page.placeId)}/daftar-harga`}>{t("claim.priceListCta")}</Link>
        </Button>
      </section>
      <OwnerFactsForm placeId={page.placeId} owner={owner} />
      <section aria-labelledby="replies-title" className="flex flex-col gap-3">
        <h2 id="replies-title" className="text-lg font-semibold">
          {t("claim.replies.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("claim.replies.intro")}</p>
        {owner.testimonies.length === 0 ? (
          <p>{t("provider.noTestimonies")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {owner.testimonies.map((testimony) => (
              <li key={testimony.id}>
                <ReplyCard testimony={testimony} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function OwnerFactsForm({ placeId, owner }: { placeId: string; owner: NonNullable<ClaimPageData["owner"]> }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language as Language;
  const firebase = useFirebaseConfig();
  const revalidator = useRevalidator();
  const id = useId();
  const initial = owner.facts;
  const [facts, setFacts] = useState<OwnerFactsSubmission>({
    ...initial,
    address: initial.address ?? "",
    phone: initial.phone ?? "",
    whatsapp: initial.whatsapp ?? "",
    openingHours: initial.openingHours ?? "",
  });
  const [state, setState] = useState<Sending>({ phase: "idle" });
  const sending = state.phase === "sending";
  const set =
    <K extends keyof OwnerFactsSubmission>(key: K) =>
    (value: OwnerFactsSubmission[K]) =>
      setFacts((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ phase: "sending" });
    const result = await send(firebase, `/api/providers/${encodeURIComponent(placeId)}/owner-facts`, facts);
    if (result.ok) {
      setState({ phase: "done", message: (result.body as OwnerContentResponse).message });
      await revalidator.revalidate();
    } else {
      setState({ phase: "error", message: result.message ?? t("claim.failed") });
    }
  };

  const toggleService = (code: string, on: boolean) =>
    set("services")(on ? [...facts.services, code as never] : facts.services.filter((service) => service !== code));

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t("claim.facts.title")}
        </h2>
        {owner.factsStatus === "held" && <Badge variant="warning">{t("claim.facts.held")}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{t("claim.facts.intro")}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t("claim.facts.name")}
          required
          maxLength={OWNER_LIMITS.nameMax}
          value={facts.name}
          onChange={set("name")}
          disabled={sending}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-type`} className="text-sm font-medium">
            {t("claim.facts.providerType")}
          </label>
          <select
            id={`${id}-type`}
            className={fieldClassName}
            value={facts.providerType}
            disabled={sending}
            onChange={(event) => set("providerType")(event.target.value as ProviderType)}
          >
            {PROVIDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`provider.type.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <RegionFields mode="pick" required value={facts.region} onChange={set("region")} disabled={sending} />
        <TextField
          label={t("claim.facts.address")}
          maxLength={OWNER_LIMITS.addressMax}
          value={facts.address ?? ""}
          onChange={set("address")}
          disabled={sending}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t("claim.facts.phone")}
            type="tel"
            maxLength={OWNER_LIMITS.phoneMax}
            value={facts.phone ?? ""}
            onChange={set("phone")}
            disabled={sending}
          />
          <TextField
            label={t("claim.facts.whatsapp")}
            type="tel"
            maxLength={OWNER_LIMITS.phoneMax}
            value={facts.whatsapp ?? ""}
            onChange={set("whatsapp")}
            disabled={sending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-hours`} className="text-sm font-medium">
            {t("claim.facts.openingHours")}
          </label>
          <Textarea
            id={`${id}-hours`}
            maxLength={OWNER_LIMITS.openingHoursMax}
            value={facts.openingHours ?? ""}
            disabled={sending}
            onChange={(event) => set("openingHours")(event.target.value)}
            className="min-h-20"
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("claim.facts.services")}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {procedureList.procedures.map((procedure) => (
              <label key={procedure.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={facts.services.includes(procedure.code as never)}
                  disabled={sending}
                  onChange={(event) => toggleService(procedure.code, event.target.checked)}
                />
                {procedure.label[language] ?? procedure.code}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" className="self-start" disabled={sending}>
          {sending ? t("claim.sending") : t("claim.facts.save")}
        </Button>
        <div aria-live="polite">
          <Feedback state={state} />
        </div>
      </form>
    </section>
  );
}

function ReplyCard({ testimony }: { testimony: OwnerTestimony }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language as Language;
  const firebase = useFirebaseConfig();
  const revalidator = useRevalidator();
  const id = useId();
  const [text, setText] = useState(testimony.reply?.text ?? "");
  const [state, setState] = useState<Sending>({ phase: "idle" });
  const sending = state.phase === "sending";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ phase: "sending" });
    const result = await send(firebase, `/api/testimonies/${encodeURIComponent(testimony.id)}/reply`, { text });
    if (result.ok) {
      setState({ phase: "done", message: (result.body as OwnerContentResponse).message });
      await revalidator.revalidate();
    } else {
      setState({ phase: "error", message: result.message ?? t("claim.failed") });
    }
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">{testimony.displayName}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("provider.visitMonth", { month: formatVisitMonth(testimony.visitMonth, language) })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="whitespace-pre-line break-words">{testimony.text}</p>
        <form onSubmit={submit} className="flex flex-col gap-2 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-reply`} className="text-sm font-medium">
              {testimony.reply ? t("claim.replies.edit") : t("claim.replies.write")}
            </label>
            {testimony.reply && <Badge variant="outline">{t(`claim.replies.status.${testimony.reply.status}`)}</Badge>}
          </div>
          <Textarea
            id={`${id}-reply`}
            required
            maxLength={OWNER_LIMITS.replyMax}
            value={text}
            disabled={sending}
            onChange={(event) => setText(event.target.value)}
            className="min-h-20"
          />
          <Button type="submit" size="sm" className="self-start" disabled={sending || !text.trim()}>
            {sending ? t("claim.sending") : t("claim.replies.send")}
          </Button>
          <div aria-live="polite" className="text-sm">
            <Feedback state={state} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
