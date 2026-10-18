import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { ProviderType, RegionRef } from "@findyourdent/contracts/firestore";
import { FileUp, LogIn } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Link, useRevalidator } from "react-router";
import { OwnerPageHeader } from "~/components/owner-page-header";
import { RegionFields } from "~/components/region-fields";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ErrorNotice } from "~/components/ui/error-notice";
import { FieldError, fieldClassName, fileInputClassName } from "~/components/ui/field";
import { Notice } from "~/components/ui/notice";
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
import { cn } from "~/lib/utils";
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
  const header = (
    <OwnerPageHeader
      backTo={providerPath(page.placeId)}
      backLabel={t("claim.back")}
      placeName={page.providerName}
      title={page.owner ? t("claim.manageTitle") : t("claim.title")}
      lead={page.owner ? t("claim.ownerIntro") : t("claim.intro")}
    />
  );
  if (page.owner) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <OwnerTools page={page} />
      </div>
    );
  }
  return (
    <Split
      main={
        <div className="flex flex-col gap-8">
          {header}
          <Explainer />
        </div>
      }
      side={<ClaimBody page={page} />}
    />
  );
}

/** Two columns from the desktop breakpoint (7:5), one column on a phone. */
function Split({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] desktop:items-start desktop:gap-10">
      {main}
      <div className="flex min-w-0 flex-col gap-4">{side}</div>
    </div>
  );
}

function ClaimBody({ page }: { page: ClaimPageData }) {
  const { t } = useTranslation();
  if (!page.signedIn) {
    const signIn = `/signin?redirectTo=${encodeURIComponent(`${providerPath(page.placeId)}/klaim`)}`;
    return (
      <FormCard>
        <Button asChild size="lg" block>
          <a href={signIn}>
            <LogIn aria-hidden="true" strokeWidth={1.75} />
            {t("claim.signIn")}
          </a>
        </Button>
      </FormCard>
    );
  }
  const claim = page.myClaim;
  if (claim?.status === "submitted") {
    return (
      <Notice tone="warning" role="status" className="text-base leading-6">
        <p>{t("claim.status.submitted", { days: CLAIM_CHECK_WORKING_DAYS })}</p>
      </Notice>
    );
  }
  if (page.claimedByOther || (page.claimed && claim?.status !== "approved")) {
    return (
      <Notice tone="info" className="text-base leading-6">
        <p>{t("claim.status.claimedByOther")}</p>
      </Notice>
    );
  }
  return (
    <>
      {claim?.status === "rejected" && (
        <ErrorNotice role="alert" className="p-4 text-base">
          <p>{t("claim.status.rejected", { reason: claim.rejectionReason ?? "" })}</p>
        </ErrorNotice>
      )}
      {claim?.status === "revoked" && (
        <Notice tone="warning" className="text-base leading-6">
          <p>{t("claim.status.revoked")}</p>
        </Notice>
      )}
      <FormCard>
        <ClaimForm placeId={page.placeId} listed={page.providerName !== null} />
      </FormCard>
    </>
  );
}

function FormCard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Card labelledBy={id} className="gap-5 p-6 shadow-md">
      <CardTitle id={id} className="text-lg leading-6">
        {t("claim.formTitle")}
      </CardTitle>
      {children}
    </Card>
  );
}

function Explainer() {
  const { t } = useTranslation();
  const id = useId();
  const steps = [
    t("claim.steps.signIn"),
    t("claim.steps.permit"),
    t("claim.steps.check", { days: CLAIM_CHECK_WORKING_DAYS }),
  ];
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby={id} className="flex flex-col gap-4">
        <h2 id={id} className="text-lg leading-6 font-[650]">
          {t("claim.howItWorks")}
        </h2>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground tabular-nums"
              >
                {index + 1}
              </span>
              <p className="pt-1.5">{step}</p>
            </li>
          ))}
        </ol>
      </section>
      <Notice tone="info">
        <p>{t("claim.ethics")}</p>
      </Notice>
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
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm leading-5 font-semibold">
        {props.label}
      </label>
      <input
        id={id}
        type={props.type ?? "text"}
        inputMode={props.type === "tel" ? "tel" : undefined}
        required={props.required}
        maxLength={props.maxLength}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={cn(fieldClassName, props.type === "tel" && "tabular-nums")}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      {props.hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
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
  if (state.phase === "done") {
    return (
      <Notice tone="success" role="status">
        <p>{state.message}</p>
      </Notice>
    );
  }
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
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2" disabled={sending}>
        <legend className="mb-2 text-sm leading-5 font-semibold">{t("claim.role")}</legend>
        {CLAIM_ROLES.map((value) => (
          <label
            key={value}
            className="flex min-h-13 cursor-pointer items-center gap-3 rounded-md border border-border-strong bg-card px-3.5 py-3 has-checked:border-2 has-checked:border-primary has-checked:bg-secondary has-checked:px-[13px]"
          >
            <input
              type="radio"
              name={`${id}-role`}
              value={value}
              checked={role === value}
              onChange={() => setRole(value)}
              className="size-5 shrink-0 accent-primary"
            />
            {t(`claim.roles.${value}`)}
          </label>
        ))}
      </fieldset>
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
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-permit`} className="flex items-center gap-2 text-sm leading-5 font-semibold">
          <FileUp aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
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
          className={cn(fileInputClassName, "rounded-md bg-muted p-3")}
        />
        <p id={`${id}-permit-hint`} className="text-sm text-muted-foreground">
          {t("claim.permitHint")}
        </p>
      </div>
      <Button type="submit" size="lg" block loading={sending} disabled={!permit}>
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
    <Split
      main={
        <div className="flex flex-col gap-8">
          <OwnerFactsForm placeId={page.placeId} owner={owner} />
          <section aria-labelledby="replies-title" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="replies-title" className="text-[22px] leading-7 font-bold tracking-[-.01em]">
                {t("claim.replies.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("claim.replies.intro")}</p>
            </div>
            {owner.testimonies.length === 0 ? (
              <p>{t("provider.noTestimonies")}</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {owner.testimonies.map((testimony) => (
                  <li key={testimony.id}>
                    <ReplyCard testimony={testimony} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      }
      side={
        <Card labelledBy="price-list-title" className="desktop:sticky desktop:top-4">
          <CardHeader>
            <CardTitle id="price-list-title" className="text-lg leading-6">
              {t("priceList.title")}
            </CardTitle>
            <CardDescription>{t("priceList.intro")}</CardDescription>
          </CardHeader>
          <Button asChild variant="secondary" block>
            <Link to={`${providerPath(page.placeId)}/daftar-harga`}>
              <FileUp aria-hidden="true" strokeWidth={1.75} />
              {t("claim.priceListCta")}
            </Link>
          </Button>
        </Card>
      }
    />
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
    <Card labelledBy={`${id}-title`} className="gap-5 p-6">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id={`${id}-title`}>{t("claim.facts.title")}</CardTitle>
          {owner.factsStatus === "held" && <Badge variant="warning">{t("claim.facts.held")}</Badge>}
        </div>
        <CardDescription>{t("claim.facts.intro")}</CardDescription>
      </CardHeader>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <TextField
          label={t("claim.facts.name")}
          required
          maxLength={OWNER_LIMITS.nameMax}
          value={facts.name}
          onChange={set("name")}
          disabled={sending}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-type`} className="text-sm leading-5 font-semibold">
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
        <div className="grid gap-5 sm:grid-cols-2">
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
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-hours`} className="text-sm leading-5 font-semibold">
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
          <legend className="mb-1 text-sm leading-5 font-semibold">{t("claim.facts.services")}</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {procedureList.procedures.map((procedure) => (
              <label key={procedure.code} className="flex min-h-touch cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={facts.services.includes(procedure.code as never)}
                  disabled={sending}
                  onChange={(event) => toggleService(procedure.code, event.target.checked)}
                  className="size-5 shrink-0 accent-primary"
                />
                {procedure.label[language] ?? procedure.code}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" className="self-start" loading={sending}>
          {sending ? t("claim.sending") : t("claim.facts.save")}
        </Button>
        <div aria-live="polite">
          <Feedback state={state} />
        </div>
      </form>
    </Card>
  );
}

const REPLY_BADGE = {
  submitted: "info",
  published: "success",
  held: "warning",
  rejected: "danger",
} as const;

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
    <Card labelledBy={`${id}-name`}>
      <CardHeader>
        <CardTitle id={`${id}-name`} className="text-base leading-6">
          {testimony.displayName}
        </CardTitle>
        <CardDescription>
          {t("provider.visitMonth", { month: formatVisitMonth(testimony.visitMonth, language) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="whitespace-pre-line break-words">{testimony.text}</p>
        <form onSubmit={submit} className="flex flex-col gap-2 border-l-2 border-secondary pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-reply`} className="text-sm leading-5 font-semibold">
              {testimony.reply ? t("claim.replies.edit") : t("claim.replies.write")}
            </label>
            {testimony.reply && (
              <Badge variant={REPLY_BADGE[testimony.reply.status]}>
                {t(`claim.replies.status.${testimony.reply.status}`)}
              </Badge>
            )}
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
          <Button type="submit" size="sm" className="self-start" loading={sending} disabled={!text.trim()}>
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
