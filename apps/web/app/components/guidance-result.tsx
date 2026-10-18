import type {
  EmergencyResponse,
  FollowUpResponse,
  Guidance,
  GuidanceResponse,
  UrgencyTier,
} from "@findyourdent/contracts";
import { Info, MapPin, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShortlistPanel } from "~/components/shortlist-panel";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field } from "~/components/ui/field";
import { UrgencyNotice } from "~/components/ui/urgency-notice";
import type { Language } from "~/i18n/config";
import { formatRupiah } from "~/lib/format";
import { procedureLabel } from "~/lib/procedures";
import { cn } from "~/lib/utils";

export interface ShareLink {
  /** /panduan/<token>, built from the Guidance object alone. */
  path: string;
  origin: string;
}

/** The two-column split the Emergency card and the Guidance share on desktop. */
const twoColumns = "grid gap-6 desktop:items-start desktop:gap-10";

export function GuidanceResult({
  response,
  pending,
  share,
}: {
  response: GuidanceResponse;
  pending: boolean;
  share?: ShareLink | null;
}) {
  const transcript = response.transcript ? <Transcript text={response.transcript} /> : null;
  if (response.kind === "emergency") {
    return (
      <div className={cn(twoColumns, "desktop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
        <div className="flex flex-col gap-4">
          {transcript}
          <EmergencyCard response={response} />
        </div>
        {/* Beside the alert, not inside it: the alert carries the IGD instruction alone. */}
        <ShortlistPanel purpose="emergency" />
      </div>
    );
  }
  if (response.kind === "followUp") {
    return (
      // On desktop, edge to edge with the hero columns above, so the question cannot pass for a footnote.
      <div className="flex max-w-2xl flex-col gap-4 desktop:max-w-none">
        {transcript}
        <FollowUpCard response={response} pending={pending} />
      </div>
    );
  }
  return (
    <GuidanceView
      guidance={response.guidance}
      share={share ?? null}
      guidanceToken={share ? shareTokenOf(share.path) : null}
      before={transcript}
    />
  );
}

/** The signed Guidance token in /panduan/<token>; the Shortlist reads the Guidance from it. */
export function shareTokenOf(path: string): string | null {
  return path.split("/").pop() || null;
}

/**
 * The Guidance card with its share and Shortlist sections, and on desktop the Summary panel
 * beside them. Used on the home page and at the shared Guidance link.
 */
export function GuidanceView({
  guidance,
  share,
  guidanceToken,
  before,
}: {
  guidance: Guidance;
  share: ShareLink | null;
  /** Signed Guidance token for the Shortlist; null hides "Lihat dokter gigi terdekat". */
  guidanceToken: string | null;
  /** Shown above the card, such as what the agent heard from a voice note. */
  before?: ReactNode;
}) {
  const { t } = useTranslation();
  const [shortlistOpenRequest, setShortlistOpenRequest] = useState(0);
  return (
    <div className={cn(twoColumns, "desktop:grid-cols-[minmax(0,1fr)_360px]")}>
      <div className="flex min-w-0 flex-col gap-6">
        {before}
        <LanguageNote guidance={guidance} />
        <GuidanceCard guidance={guidance} />
        {share && <ShareSection share={share} />}
        {guidanceToken && (
          // The Summary panel's link opens the panel here; without script its hash still lands on the section.
          <section id={SHORTLIST_ID} tabIndex={-1} aria-label={t("shortlist.title")} className="scroll-mt-6">
            <ShortlistPanel purpose="shortlist" guidanceToken={guidanceToken} openRequest={shortlistOpenRequest} />
          </section>
        )}
      </div>
      <SummaryPanel
        guidance={guidance}
        hasShortlist={guidanceToken !== null}
        onOpenShortlist={() => setShortlistOpenRequest((n) => n + 1)}
      />
    </div>
  );
}

/**
 * After the language toggle the card keeps its words, which follow the complaint's
 * language (spec 01), not the toggle. Asking again would only repeat them, so the note
 * says how to get the other language instead.
 */
function LanguageNote({ guidance }: { guidance: Guidance }) {
  const { t, i18n } = useTranslation();
  if (!guidance.language || guidance.language === i18n.language) return null;
  return (
    <p role="note" className="flex items-start gap-2.5 rounded-md bg-muted px-4 py-3" data-testid="guidance-language">
      <Info aria-hidden="true" strokeWidth={1.75} className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <span>{t(`card.languageNote.${guidance.language}`)}</span>
    </p>
  );
}

function Transcript({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted px-4 py-3 text-sm" data-testid="transcript">
      <p>
        <span className="font-semibold">{t("card.transcriptLabel")}: </span>
        {text}
      </p>
      <p className="text-muted-foreground">{t("card.transcriptHint")}</p>
    </div>
  );
}

/**
 * Free Google Maps search for the nearest IGD: a plain Maps URL, no Places API call.
 * Fixed query, so the Patient's complaint never ends up in a link. Kept beside the
 * nearby-Hospitals list, which needs a location first.
 */
const NEAREST_IGD_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("IGD rumah sakit terdekat")}`;

/** The IGD instruction and nothing else: a plain alert, nothing promotional. */
function EmergencyCard({ response }: { response: EmergencyResponse }) {
  const { t } = useTranslation();
  return (
    <Card variant="emergency" data-kind="emergency" labelledBy="emergency-title" className="gap-5 p-6">
      {/* The card is the alert already, so the notice is not a second one. */}
      <UrgencyNotice
        tier="darurat"
        alert={false}
        label={t("urgency.darurat.label")}
        description={t("urgency.darurat.description")}
      />
      <CardHeader className="gap-2">
        <CardTitle id="emergency-title">{t("card.emergency.title")}</CardTitle>
        <CardDescription className="text-base text-foreground">{response.reason}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-lg leading-7 font-medium">{t("card.emergency.action")}</p>
        <div className="flex flex-col gap-2">
          <h3 className="font-[650]">{t("card.emergency.redFlagsLabel")}</h3>
          <ul className="flex flex-col gap-2">
            {response.redFlags.map((flag) => (
              <li key={flag} className="flex items-start gap-2.5">
                <TriangleAlert
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mt-0.5 size-5 shrink-0 text-destructive"
                />
                <span>{t(`redFlag.${flag}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <Button asChild size="lg" block className="h-auto whitespace-normal py-3 text-center">
          <a href={NEAREST_IGD_MAPS_URL} target="_blank" rel="noreferrer">
            <MapPin aria-hidden="true" strokeWidth={1.75} />
            {t("card.emergency.findIgd")}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function FollowUpCard({ response, pending }: { response: FollowUpResponse; pending: boolean }) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const hasQuickReplies = Boolean(response.quickReplies?.length);
  // The question lands below the complaint box, often under the fold: bring it into view and
  // move focus to it, so neither sighted nor screen reader users miss that an answer is wanted.
  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    title.closest("section")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    title.focus({ preventScroll: true });
  }, []);
  return (
    <Card variant="attention" data-kind="followUp" labelledBy="follow-up-title" className="gap-5 p-6 desktop:p-8">
      <CardHeader className="gap-3">
        <Badge variant="brand">{t("card.followUp.badge")}</Badge>
        <div className="flex items-start gap-3">
          <MessageCircleQuestion
            aria-hidden="true"
            strokeWidth={1.75}
            className="mt-0.5 size-7 shrink-0 text-primary"
          />
          <div className="flex flex-col gap-1.5">
            <CardTitle id="follow-up-title" ref={titleRef} tabIndex={-1} className="outline-none">
              {t("card.followUp.title")}
            </CardTitle>
            <CardDescription className="text-lg leading-7 font-semibold text-foreground desktop:text-xl desktop:leading-8">
              {response.question}
            </CardDescription>
            <p className="text-sm text-muted-foreground">{t("card.followUp.hint")}</p>
          </div>
        </div>
      </CardHeader>
      {/* On desktop the quick replies lead as wide tiles; writing an answer is the fallback below them. */}
      <CardContent className="flex flex-col gap-5 border-t pt-5 desktop:gap-6">
        {/* Sent back with the answer so the agent knows what "Ya" or "Tidak" replies to. */}
        <input type="hidden" name="followUpQuestion" value={response.question} />
        {hasQuickReplies && (
          <fieldset className="flex flex-wrap gap-2 desktop:grid desktop:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] desktop:gap-3">
            <legend className="mb-2 text-sm font-semibold desktop:mb-3 desktop:text-base">
              {t("card.followUp.quickRepliesLabel")}
            </legend>
            {response.quickReplies?.map((reply) => (
              <Button
                key={reply}
                type="submit"
                name="followUpAnswer"
                value={reply}
                variant="secondary"
                size="lg"
                disabled={pending}
              >
                {reply}
              </Button>
            ))}
          </fieldset>
        )}
        {hasQuickReplies && (
          <p className="hidden items-center gap-3 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border desktop:flex">
            {t("card.followUp.orWrite")}
          </p>
        )}
        <div className="flex flex-col gap-3 desktop:grid desktop:grid-cols-[minmax(0,1fr)_auto] desktop:items-end">
          <Field
            id="followUpAnswer"
            name="followUpAnswer"
            label={t("card.followUp.answerLabel")}
            rows={2}
            maxLength={1000}
            className="[&_textarea]:min-h-16 desktop:[&_textarea]:min-h-12"
          />
          {/* Beside the quick replies the written answer is the alternative, so its button steps back. */}
          <Button
            type="submit"
            variant={hasQuickReplies ? "outline" : "primary"}
            disabled={pending}
            className="self-end"
          >
            {t("card.followUp.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const eyebrow = "text-xs leading-4 font-bold tracking-[.08em] text-muted-foreground uppercase";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={eyebrow}>{title}</h3>
      {children}
    </section>
  );
}

/** Least to most urgent, as the scale under the Urgency Tier reads. */
const TIERS: readonly UrgencyTier[] = ["rutin", "terjadwal", "segera", "darurat"];
const TIER_FILL: Record<UrgencyTier, string> = {
  rutin: "bg-border-strong",
  terjadwal: "bg-primary",
  segera: "bg-warning-line",
  darurat: "bg-destructive",
};

/** A picture of where the tier sits; the notice above already says it in words. */
function UrgencyScale({ tier }: { tier: UrgencyTier }) {
  const { t } = useTranslation();
  const reached = TIERS.indexOf(tier);
  return (
    <div aria-hidden="true" className="flex flex-col gap-1.5">
      <div className="grid grid-cols-4 gap-1">
        {TIERS.map((step, index) => (
          <span key={step} className={cn("h-1.5 rounded-full", index <= reached ? TIER_FILL[tier] : "bg-muted")} />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1 text-xs leading-4 font-medium text-muted-foreground">
        {TIERS.map((step) => (
          <span key={step} className="text-center first:text-left last:text-right">
            {t(`urgency.${step}.label`)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GuidanceCard({ guidance }: { guidance: Guidance }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === "en" ? "en" : "id") as Language;
  return (
    <Card data-kind="guidance" labelledBy="guidance-title" className="gap-7 p-6">
      <CardHeader>
        <CardTitle id="guidance-title" className="text-[28px] leading-[34px] font-bold tracking-[-.015em]">
          {t("card.guidance.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-7">
        <Section title={t("card.guidance.urgencyLabel")}>
          <UrgencyNotice
            tier={guidance.urgencyTier}
            label={t(`urgency.${guidance.urgencyTier}.label`)}
            description={t(`urgency.${guidance.urgencyTier}.description`)}
          />
          <UrgencyScale tier={guidance.urgencyTier} />
        </Section>

        <Section title={t("card.guidance.categoryLabel")}>
          <p className="text-lg leading-6 font-[650]">{t(`category.${guidance.likelyCategory.code}`)}</p>
          <p className="text-muted-foreground">{guidance.likelyCategory.explanation}</p>
        </Section>

        <Section title={t("card.guidance.journeyLabel")}>
          <p className="font-semibold">
            {guidance.journey.type === "single" ? t("card.guidance.journeySingle") : t("card.guidance.journeyMulti")}
          </p>
          <ol className="flex flex-col gap-4">
            {[...guidance.journey.visits]
              .sort((a, b) => a.order - b.order)
              .map((visit) => (
                <li key={visit.order} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground tabular-nums"
                  >
                    {visit.order}
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="font-semibold">{t("card.guidance.visit", { order: visit.order })}</span>
                    <span className="text-muted-foreground">{visit.purpose}</span>
                  </span>
                </li>
              ))}
          </ol>
        </Section>

        <Section title={t("card.guidance.proceduresLabel")}>
          <ul className="flex flex-wrap gap-1.5">
            {guidance.likelyProcedures.map((code) => (
              <li key={code}>
                <Badge variant="neutral">{procedureLabel(code, language)}</Badge>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("card.guidance.costLabel")}>
          <ul className="flex flex-col gap-3">
            {guidance.costEstimate.map((cost) => (
              <li key={cost.procedureCode} className="flex flex-col gap-1 rounded-md bg-muted px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{procedureLabel(cost.procedureCode, language)}</span>
                  <Badge variant="outline">{t("estimate")}</Badge>
                </div>
                <p className="text-[22px] leading-7 font-bold tracking-[-.01em] tabular-nums">
                  {t("card.guidance.costRange", {
                    min: formatRupiah(cost.minRupiah, language),
                    max: formatRupiah(cost.maxRupiah, language),
                  })}
                </p>
                <p className="text-xs leading-4 font-medium text-muted-foreground">
                  {t("card.guidance.costSource", { source: cost.source })}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("card.guidance.whyPricesVaryLabel")}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {guidance.whyPricesVary.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Section>

        <Section title={t("card.guidance.bpjsLabel")}>
          <div className="flex items-start gap-3 rounded-md border border-info-line bg-info-soft px-4 py-3">
            <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0 text-info" />
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{t(`bpjs.${guidance.bpjs.status}`)}</p>
              <p>{guidance.bpjs.explanation}</p>
            </div>
          </div>
        </Section>

        <Section title={t("card.guidance.sourcesLabel")}>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {guidance.sources.map((source) => (
              <li key={`${source.title}-${source.citation ?? ""}`}>
                {source.url ? (
                  <a href={source.url} className="text-primary underline" rel="noreferrer" target="_blank">
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}
                {source.citation && <span className="text-muted-foreground"> ({source.citation})</span>}
              </li>
            ))}
          </ul>
        </Section>

        <p className="border-t pt-4 text-sm font-semibold">{guidance.disclaimer}</p>
      </CardContent>
    </Card>
  );
}

const SHORTLIST_ID = "shortlist";

/**
 * Moves to the Shortlist section without a hash navigation, which would start a new history entry.
 * The panel then opens and takes focus itself.
 */
function goToShortlist(event: MouseEvent<HTMLAnchorElement>, open: () => void) {
  const target = document.getElementById(SHORTLIST_ID);
  if (!target) return;
  event.preventDefault();
  open();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

/** Desktop only: the Guidance at a glance, with the next step always in view. */
function SummaryPanel({
  guidance,
  hasShortlist,
  onOpenShortlist,
}: {
  guidance: Guidance;
  hasShortlist: boolean;
  onOpenShortlist: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === "en" ? "en" : "id") as Language;
  // The first estimate is the main procedure's; a span across procedures would be neither one nor a total.
  const cost = guidance.costEstimate[0];
  return (
    <aside aria-labelledby="summary-title" className="hidden desktop:sticky desktop:top-6 desktop:block">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
        <h2 id="summary-title" className={eyebrow}>
          {t("card.summary.title")}
        </h2>
        {/* The Guidance card already announces a darurat tier. */}
        <UrgencyNotice
          tier={guidance.urgencyTier}
          alert={false}
          label={t(`urgency.${guidance.urgencyTier}.label`)}
          description={t(`urgency.${guidance.urgencyTier}.description`)}
        />
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1">
          <dt className="text-muted-foreground">{t("card.summary.likely")}</dt>
          <dd className="font-semibold">{t(`category.${guidance.likelyCategory.code}`)}</dd>
          <dt className="text-muted-foreground">{t("card.summary.visits")}</dt>
          <dd className="font-semibold tabular-nums">
            {t("card.summary.visitsCount", { count: guidance.journey.visits.length })}
          </dd>
          {cost && (
            <>
              <dt className="text-muted-foreground">{t("card.summary.cost")}</dt>
              <dd className="font-semibold tabular-nums">
                {t("card.guidance.costRange", {
                  min: formatRupiah(cost.minRupiah, language),
                  max: formatRupiah(cost.maxRupiah, language),
                })}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">{t("card.summary.bpjs")}</dt>
          <dd className="font-semibold">{t(`bpjs.${guidance.bpjs.status}`)}</dd>
        </dl>
        {hasShortlist && (
          // A link, not a button: the Shortlist section keeps the one button with this name.
          <Button asChild block>
            <a href={`#${SHORTLIST_ID}`} onClick={(event) => goToShortlist(event, onOpenShortlist)}>
              {t("card.summary.toShortlist")}
            </a>
          </Button>
        )}
        <p className="text-xs leading-4 font-medium text-muted-foreground">{t("card.summary.emergencyReminder")}</p>
      </div>
    </aside>
  );
}

function ShareSection({ share }: { share: ShareLink }) {
  const { t } = useTranslation();
  const url = `${share.origin}${share.path}`;
  return (
    <Card variant="flat" labelledBy="share-title" className="p-6">
      <CardHeader className="gap-2">
        <CardTitle id="share-title" className="text-lg leading-6">
          {t("card.share.title")}
        </CardTitle>
        <CardDescription>{t("card.share.privacy")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={`https://wa.me/?text=${encodeURIComponent(url)}`} rel="noreferrer" target="_blank">
            {t("card.share.whatsapp")}
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={share.path}>{t("card.share.open")}</a>
        </Button>
      </CardContent>
    </Card>
  );
}
