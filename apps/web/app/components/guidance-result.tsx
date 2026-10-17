import type {
  EmergencyResponse,
  FollowUpResponse,
  Guidance,
  GuidanceResponse,
  UrgencyTier,
} from "@findyourdent/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import type { Language } from "~/i18n/config";
import { formatRupiah } from "~/lib/format";
import { procedureLabel } from "~/lib/procedures";
import { cn } from "~/lib/utils";

export interface ShareLink {
  /** /panduan/<token>, built from the Guidance object alone. */
  path: string;
  origin: string;
}

export function GuidanceResult({
  response,
  pending,
  share,
}: {
  response: GuidanceResponse;
  pending: boolean;
  share?: ShareLink | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {response.transcript && <Transcript text={response.transcript} />}
      {response.kind === "emergency" && <EmergencyCard response={response} />}
      {response.kind === "followUp" && <FollowUpCard response={response} pending={pending} />}
      {response.kind === "guidance" && <GuidanceCard guidance={response.guidance} share={share ?? null} />}
    </div>
  );
}

function Transcript({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm">
      <span className="font-medium">{t("card.transcriptLabel")}: </span>
      {text}
    </p>
  );
}

/**
 * Free Google Maps search for the nearest IGD: a plain Maps URL, no Places API call.
 * Fixed query, so the Patient's complaint never ends up in a link. Replaced by the
 * nearby-Hospitals list when Places lands (T08).
 */
const NEAREST_IGD_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("IGD rumah sakit terdekat")}`;

function EmergencyCard({ response }: { response: EmergencyResponse }) {
  const { t } = useTranslation();
  return (
    <Card role="alert" className="border-destructive bg-destructive-soft" data-kind="emergency">
      <CardHeader>
        <CardTitle className="text-2xl text-destructive">{t("card.emergency.title")}</CardTitle>
        <CardDescription className="text-base text-foreground">{response.reason}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="font-medium">{t("card.emergency.action")}</p>
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t("card.emergency.redFlagsLabel")}</h3>
          <ul className="list-inside list-disc text-sm">
            {response.redFlags.map((flag) => (
              <li key={flag}>{t(`redFlag.${flag}`)}</li>
            ))}
          </ul>
        </div>
        <Button
          asChild
          variant="destructive"
          size="lg"
          className="h-auto w-full whitespace-normal py-3 text-center sm:w-auto sm:self-start"
        >
          <a href={NEAREST_IGD_MAPS_URL} target="_blank" rel="noreferrer">
            {t("card.emergency.findIgd")}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function FollowUpCard({ response, pending }: { response: FollowUpResponse; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <Card data-kind="followUp">
      <CardHeader>
        <CardTitle>{t("card.followUp.title")}</CardTitle>
        <CardDescription className="text-base text-foreground">{response.question}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Sent back with the answer so the agent knows what "Ya" or "Tidak" replies to. */}
        <input type="hidden" name="followUpQuestion" value={response.question} />
        {response.quickReplies && response.quickReplies.length > 0 && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t("home.quickRepliesLabel")}</legend>
            {response.quickReplies.map((reply) => (
              <Button
                key={reply}
                type="submit"
                name="followUpAnswer"
                value={reply}
                variant="secondary"
                disabled={pending}
              >
                {reply}
              </Button>
            ))}
          </fieldset>
        )}
        <label htmlFor="followUpAnswer" className="text-sm font-medium">
          {t("home.followUpAnswerLabel")}
        </label>
        <Textarea id="followUpAnswer" name="followUpAnswer" maxLength={1000} className="min-h-16" />
        <Button type="submit" disabled={pending} className="self-start">
          {t("home.followUpSubmit")}
        </Button>
      </CardContent>
    </Card>
  );
}

const urgencyStyles: Record<UrgencyTier, string> = {
  darurat: "bg-destructive text-white",
  segera: "bg-warning-soft text-warning-foreground border-warning-foreground/30",
  terjadwal: "bg-secondary text-secondary-foreground",
  rutin: "bg-muted text-muted-foreground",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function GuidanceCard({ guidance, share }: { guidance: Guidance; share: ShareLink | null }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === "en" ? "en" : "id") as Language;
  return (
    <Card data-kind="guidance">
      <CardHeader>
        <CardTitle>{t("card.guidance.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Section title={t("card.guidance.urgencyLabel")}>
          <div className={cn("flex flex-col gap-0.5 rounded-md border px-3 py-2", urgencyStyles[guidance.urgencyTier])}>
            <span className="font-semibold">{t(`urgency.${guidance.urgencyTier}.label`)}</span>
            <span className="text-sm">{t(`urgency.${guidance.urgencyTier}.description`)}</span>
          </div>
        </Section>

        <Section title={t("card.guidance.categoryLabel")}>
          <p className="font-medium">{t(`category.${guidance.likelyCategory.code}`)}</p>
          <p className="text-sm">{guidance.likelyCategory.explanation}</p>
        </Section>

        <Section title={t("card.guidance.journeyLabel")}>
          <p className="font-medium">
            {guidance.journey.type === "single" ? t("card.guidance.journeySingle") : t("card.guidance.journeyMulti")}
          </p>
          <ol className="flex flex-col gap-1 text-sm">
            {[...guidance.journey.visits]
              .sort((a, b) => a.order - b.order)
              .map((visit) => (
                <li key={visit.order}>
                  <span className="font-medium">{t("card.guidance.visit", { order: visit.order })}: </span>
                  {visit.purpose}
                </li>
              ))}
          </ol>
        </Section>

        <Section title={t("card.guidance.proceduresLabel")}>
          <ul className="flex flex-wrap gap-1.5">
            {guidance.likelyProcedures.map((code) => (
              <li key={code}>
                <Badge variant="secondary">{procedureLabel(code, language)}</Badge>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("card.guidance.whyPricesVaryLabel")}>
          <ul className="list-inside list-disc text-sm">
            {guidance.whyPricesVary.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Section>

        <Section title={t("card.guidance.costLabel")}>
          <ul className="flex flex-col gap-2">
            {guidance.costEstimate.map((cost) => (
              <li key={cost.procedureCode} className="rounded-md bg-muted px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{procedureLabel(cost.procedureCode, language)}</span>
                  <Badge variant="outline">{t("estimate")}</Badge>
                </div>
                <p className="font-semibold">
                  {t("card.guidance.costRange", {
                    min: formatRupiah(cost.minRupiah, language),
                    max: formatRupiah(cost.maxRupiah, language),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("card.guidance.costSource", { source: cost.source })}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("card.guidance.bpjsLabel")}>
          <p className="font-medium">{t(`bpjs.${guidance.bpjs.status}`)}</p>
          <p className="text-sm">{guidance.bpjs.explanation}</p>
        </Section>

        <Section title={t("card.guidance.sourcesLabel")}>
          <ul className="flex flex-col gap-1 text-sm">
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

        <p className="border-t pt-4 text-sm font-medium">{guidance.disclaimer}</p>

        {share && <ShareSection share={share} />}
      </CardContent>
    </Card>
  );
}

function ShareSection({ share }: { share: ShareLink }) {
  const { t } = useTranslation();
  const url = `${share.origin}${share.path}`;
  return (
    <Section title={t("card.share.title")}>
      <p className="text-sm text-muted-foreground">{t("card.share.privacy")}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={`https://wa.me/?text=${encodeURIComponent(url)}`} rel="noreferrer" target="_blank">
            {t("card.share.whatsapp")}
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={share.path}>{t("card.share.open")}</a>
        </Button>
      </div>
    </Section>
  );
}
