import type { DetectionRuleCode } from "@findyourdent/contracts/firestore";
import { Clock } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useRevalidator } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { getI18n, type Language } from "~/i18n/config";
import {
  ADMIN_REASON_MAX_CHARS,
  type AdminActionRequest,
  type AdminApiError,
  type ApprovedClaim,
  type QueueClaim,
  type QueueDetection,
  type QueueItem,
  type QueueModeration,
  type QueueOwnerFacts,
  type QueuePolicyViolation,
  type QueueProof,
  type QueueProofMatch,
  type QueueTestimony,
  type QueueTestimonyContent,
  REASON_REQUIRED,
  type TestimonyAction,
} from "~/lib/admin-queue";
import { ASPECTS } from "~/lib/aspects";
import { formatRupiah, formatVisitMonth } from "~/lib/format";
import { providerPath } from "~/lib/paths";
import { procedureLabel } from "~/lib/procedures";
import { regionLabel } from "~/lib/regions";
import { testimonyStatusBadge } from "~/lib/testimony-status";
import { loadAdminQueue } from "~/server/admin-queue.server";
import { SIMILARITY_THRESHOLD } from "~/server/detection";
import type { Route } from "./+types/admin";

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: t("admin.title") }, { name: "robots", content: "noindex" }];
}

/**
 * Admin queue (spec 03). Only allowlisted accounts get here: the Express gate
 * (server/auth.ts) refuses everyone else on every /admin URL before React Router runs.
 * Actions go to POST /admin/api/actions, behind the same gate.
 */
export async function loader({ context }: Route.LoaderArgs) {
  if (!context.admin) throw new Response(null, { status: 403 });
  const { items, approvedClaims } = context.firestore
    ? await loadAdminQueue(context, context.firestore)
    : { items: [], approvedClaims: [] };
  return { email: context.admin.email, items, approvedClaims };
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { items, approvedClaims } = loaderData;
  const overdue = items.filter((item) => item.overdue).length;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="admin-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="admin-title" className="text-2xl font-bold">
          {t("admin.title")}
        </h1>
        <Form method="post" action="/auth/signout">
          <Button type="submit" variant="outline" size="sm">
            {t("admin.signOut")}
          </Button>
        </Form>
      </div>
      <p className="text-muted-foreground">{t("admin.signedInAs", { email: loaderData.email })}</p>
      <p>
        {t("admin.queue.summary", { count: items.length })}
        {overdue > 0 && (
          <strong className="text-destructive"> {t("admin.queue.overdueCount", { count: overdue })}</strong>
        )}
      </p>
      {items.length === 0 ? (
        <p>{t("admin.queue.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <QueueCard item={item} />
            </li>
          ))}
        </ul>
      )}
      {approvedClaims.length > 0 && <ApprovedClaims claims={approvedClaims} />}
    </section>
  );
}

/** Approved Claims, so a wrong approval can be revoked. */
function ApprovedClaims({ claims }: { claims: ApprovedClaim[] }) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        {t("admin.queue.approvedClaims", { count: claims.length })}
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {claims.map((claim) => (
          <li key={claim.claimId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <a href={providerPath(claim.placeId)} className="underline">
                {claim.providerName || claim.placeId}
              </a>{" "}
              · {formatTime(claim.reviewedAt, language)}
              {claim.reviewedBy && <> · {claim.reviewedBy}</>}
            </span>
            <ActionButton request={{ action: "revokeClaim", subjectId: claim.claimId }} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === "en" ? "en" : "id";
}

function formatTime(iso: string, language: Language) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function QueueCard({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const headingId = `queue-${item.kind}-${item.id}`;
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {t(`admin.queue.kind.${item.kind}`)}
          {item.testimony && <span className="font-normal"> · {item.testimony.providerName}</span>}
          {item.claim && <span className="font-normal"> · {item.claim.providerName}</span>}
          {item.reply && <span className="font-normal"> · {item.reply.providerName}</span>}
          {item.ownerFacts && <span className="font-normal"> · {item.ownerFacts.currentName}</span>}
          {item.violation && (
            <span className="font-normal"> · {item.violation.providerName || item.violation.placeId}</span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {item.testimony && (
            <Badge {...testimonyStatusBadge(item.testimony.status)}>
              {t(`admin.queue.status.${item.testimony.status}`)}
            </Badge>
          )}
          <Badge variant={item.overdue ? "danger" : "outline"} icon={item.overdue ? undefined : Clock}>
            {item.overdue
              ? t("admin.queue.overdue", { due: formatTime(item.dueAt, language) })
              : t("admin.queue.due", { due: formatTime(item.dueAt, language) })}
          </Badge>
        </div>
      </header>

      {item.reports && (
        <section aria-label={t("admin.queue.reports")} className="flex flex-col gap-2">
          <h3 className="font-medium">{t("admin.queue.reports")}</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {item.reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-2">
                <span>
                  <strong>{t(`report.categories.${report.category}`)}</strong>
                  {report.hidTestimony && <> · {t("admin.queue.hidByReport")}</>} ·{" "}
                  {formatTime(report.createdAt, language)}
                  {report.details && <span className="block whitespace-pre-line">{report.details}</span>}
                </span>
                <span className="flex flex-wrap items-start gap-2">
                  {item.testimony?.status !== "hidden" && (
                    <ActionButton request={{ action: "dismissReport", subjectId: report.id }} />
                  )}
                  {report.category === "incentive" && item.testimony && (
                    <OpenViolation
                      placeId={item.testimony.placeId}
                      since={item.createdAt}
                      evidence={{ reportIds: [report.id] }}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.detection && <DetectionView detection={item.detection} />}
      {item.proof && <ProofView proof={item.proof} />}
      {item.testimony && <TestimonyView testimony={item.testimony} />}
      {item.correction && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("admin.queue.correction.current")}</dt>
          <dd>
            <a href={providerPath(item.correction.placeId)} className="underline">
              {item.correction.currentName}
            </a>{" "}
            · {regionLabel(item.correction.currentRegion)}
          </dd>
          <dt className="text-muted-foreground">{t("admin.queue.correction.suggested")}</dt>
          <dd>
            {item.correction.suggestedName ?? item.correction.currentName} ·{" "}
            {regionLabel(item.correction.suggestedRegion ?? item.correction.currentRegion)}
          </dd>
        </dl>
      )}

      {item.claim && <ClaimView claim={item.claim} />}
      {item.violation && <ViolationView violation={item.violation} />}
      {item.ownerFacts && <OwnerFactsView ownerFacts={item.ownerFacts} />}
      {item.reply && (
        <div className="flex flex-col gap-2 text-sm">
          <ModerationLine moderation={item.reply.moderation} />
          <p className="text-muted-foreground">{t("admin.queue.replyTo")}</p>
          <blockquote className="whitespace-pre-line border-l-2 pl-3 text-muted-foreground">
            {item.reply.testimonyText}
          </blockquote>
          <FlaggedText text={item.reply.text} moderation={item.reply.moderation} />
        </div>
      )}

      <Actions item={item} />
    </article>
  );
}

function ModerationLine({ moderation }: { moderation: QueueModeration | null }) {
  const { t } = useTranslation();
  if (!moderation) return null;
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{t("admin.queue.gemini")}</span> <strong>{moderation.decision}</strong>
      {moderation.ruleCodes.length > 0 && <> · {moderation.ruleCodes.join(", ")}</>} ·{" "}
      {t("admin.queue.confidence", { value: moderation.confidence.toFixed(2) })} · {moderation.model}
      {moderation.detectionRuleCodes?.map((code) => (
        <Badge key={code} variant="danger" className="ml-2">
          {code}
        </Badge>
      ))}
    </p>
  );
}

/** What each detection rule code means to the admin. */
const DETECTION_RULE: Record<DetectionRuleCode, "velocity" | "similarity" | "sharedDevice"> = {
  D1: "velocity",
  D2: "similarity",
  D3: "sharedDevice",
};

/** A D2 similarity score as a whole percentage. */
const percent = (similarity: number) => Math.round(similarity * 100);

/** Admin only: the Provider's other Testimonies behind a detection hold, and who wrote them. */
function DetectionView({ detection }: { detection: QueueDetection }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const accountState = (elsewhere: boolean) =>
    elsewhere ? t("admin.queue.detection.otherProviders") : t("admin.queue.detection.onlyThisProvider");
  return (
    <section aria-label={t("admin.queue.detection.title")} className="flex min-w-0 flex-col gap-2 text-sm">
      <h3 className="flex flex-wrap items-center gap-2 font-medium">
        {t("admin.queue.detection.title")}
        {detection.ruleCodes.map((code) => (
          <span key={code} className="flex flex-wrap items-center gap-2 font-normal">
            <Badge variant="danger">{code}</Badge>
            <span className="text-muted-foreground">{t(`admin.queue.detection.${DETECTION_RULE[code]}`)}</span>
          </span>
        ))}
      </h3>
      <p>
        <span className="text-muted-foreground">{t("admin.queue.detection.author")}:</span>{" "}
        <strong>{accountState(detection.authorWroteAboutOtherProviders)}</strong>
      </p>
      {detection.similar && (
        <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted p-2">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">{t("admin.queue.detection.similar")}:</span>
            <strong className="break-words">{detection.similar.displayName}</strong>
            <Badge {...testimonyStatusBadge(detection.similar.status)}>
              {t(`admin.queue.status.${detection.similar.status}`)}
            </Badge>
            <span className="text-muted-foreground">{formatTime(detection.similar.createdAt, language)}</span>
            <Badge variant={detection.similar.similarity >= SIMILARITY_THRESHOLD ? "danger" : "outline"}>
              {t("admin.queue.detection.score", { value: percent(detection.similar.similarity) })}
            </Badge>
          </span>
          <span className={detection.similar.wroteAboutOtherProviders ? "" : "font-semibold text-destructive"}>
            {accountState(detection.similar.wroteAboutOtherProviders)}
          </span>
          <span className="whitespace-pre-line break-words text-muted-foreground">{detection.similar.textPreview}</span>
        </div>
      )}
      {(detection.ruleCodes.includes("D1") || detection.ruleCodes.includes("D2")) && (
        <>
          <p className="text-muted-foreground">
            {t("admin.queue.detection.linked", { count: detection.linked.length })}
          </p>
          <ol className="flex flex-col gap-2">
            {detection.linked.map((linked) => (
              <li key={linked.id} className="flex min-w-0 flex-col gap-1 rounded-md bg-muted p-2">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="break-words">{linked.displayName}</strong>
                  <Badge {...testimonyStatusBadge(linked.status)}>{t(`admin.queue.status.${linked.status}`)}</Badge>
                  <span className="text-muted-foreground">{formatTime(linked.createdAt, language)}</span>
                  {linked.withinDay && <Badge variant="outline">{t("admin.queue.detection.withinDay")}</Badge>}
                  <Badge variant="outline">
                    {t("admin.queue.detection.score", { value: percent(linked.similarity) })}
                  </Badge>
                </span>
                <span className={linked.wroteAboutOtherProviders ? "" : "font-semibold text-destructive"}>
                  {accountState(linked.wroteAboutOtherProviders)}
                </span>
                <span className="whitespace-pre-line break-words text-muted-foreground">{linked.textPreview}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {detection.sharedDevice && (
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="font-medium">{t("admin.queue.detection.sameDeviceTitle")}</h4>
          <p className="text-muted-foreground">
            {detection.sharedDevice.length
              ? t("admin.queue.detection.sameDevice", { count: detection.sharedDevice.length })
              : t("admin.queue.detection.sameDeviceNone")}
          </p>
          <ul className="flex flex-col gap-2">
            {detection.sharedDevice.map((account) => (
              <li key={account.testimonyId} className="flex min-w-0 flex-col gap-1 rounded-md bg-muted p-2">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="break-words">{account.displayName || t("admin.queue.detection.noName")}</strong>
                  <Badge {...testimonyStatusBadge(account.status)}>{t(`admin.queue.status.${account.status}`)}</Badge>
                  {account.sharedIp && <Badge variant="outline">{t("admin.queue.detection.sharedIp")}</Badge>}
                  {account.sharedBrowser && <Badge variant="outline">{t("admin.queue.detection.sharedBrowser")}</Badge>}
                </span>
                <span className={account.wroteAboutOtherProviders ? "" : "font-semibold text-destructive"}>
                  {accountState(account.wroteAboutOtherProviders)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The permit, the claimant's details and the live Google listing phone to call. */
function ClaimView({ claim }: { claim: QueueClaim }) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t("admin.queue.claim.place")}</dt>
      <dd>
        <a href={providerPath(claim.placeId)} className="underline">
          {claim.providerName}
        </a>
        {!claim.listed && <> · {t("admin.queue.claim.notListed")}</>}
      </dd>
      <dt className="text-muted-foreground">{t("admin.queue.claim.role")}</dt>
      <dd>{t(`claim.roles.${claim.role}`)}</dd>
      <dt className="text-muted-foreground">{t("admin.queue.claim.contactPhone")}</dt>
      <dd>{claim.contactPhone}</dd>
      <dt className="text-muted-foreground">{t("admin.queue.claim.googlePhone")}</dt>
      <dd>
        {claim.googlePhone ? (
          <a href={`tel:${claim.googlePhone.replace(/[^\d+]/g, "")}`} className="font-semibold underline">
            {claim.googlePhone}
          </a>
        ) : (
          t("admin.queue.claim.noGooglePhone")
        )}
        {claim.googleDisplayName && <span className="text-muted-foreground"> · {claim.googleDisplayName}</span>}
      </dd>
      <dt className="text-muted-foreground">{t("admin.queue.claim.permit")}</dt>
      <dd>
        {claim.permitUrl ? (
          <a href={claim.permitUrl} target="_blank" rel="noreferrer" className="underline">
            {t("admin.queue.claim.openPermit")}
          </a>
        ) : (
          "-"
        )}
      </dd>
      <dd className="col-span-2 text-xs text-muted-foreground">{t("admin.queue.claim.callHint")}</dd>
    </dl>
  );
}

/** The held proof: its private file, why the check sent it here and what was read off it. */
function ProofView({ proof }: { proof: QueueProof }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { extracted } = proof;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t("admin.queue.proof.file")}</dt>
      <dd>
        <a href={proof.fileUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
          {t("admin.queue.proof.openFile")}
        </a>
      </dd>
      <dt className="text-muted-foreground">{t("admin.queue.proof.reasons")}</dt>
      <dd>{proof.reasons.map((reason) => t(`admin.queue.proof.reason.${reason}`)).join(" · ")}</dd>
      <dt className="text-muted-foreground">{t("admin.queue.proof.extracted")}</dt>
      <dd>
        {extracted ? (
          <>
            {t("admin.queue.proof.clinicName")}: {extracted.clinicName ?? "-"} · {t("admin.queue.proof.proofDate")}:{" "}
            {extracted.proofDate ?? "-"} · {t("admin.queue.proof.total")}:{" "}
            {extracted.totalRupiah !== undefined ? formatRupiah(extracted.totalRupiah, language) : "-"}
          </>
        ) : (
          t("admin.queue.proof.nothingRead")
        )}
      </dd>
      {(proof.reasons.includes("possibleReuse") || (proof.reuseMatches?.length ?? 0) > 0) && (
        <ReuseMatches matches={proof.reuseMatches ?? []} />
      )}
      <dd className="col-span-2 text-xs text-muted-foreground">{t("admin.queue.proof.expiryHint")}</dd>
    </dl>
  );
}

/**
 * The Testimonies whose Proof Fingerprint matches the held proof (spec 09). Rendered inside
 * ProofView's dl. A published match links to its public Provider page; when the reason is
 * `possibleReuse` but no match is left, the other Testimony was deleted since.
 */
function ReuseMatches({ matches }: { matches: QueueProofMatch[] }) {
  const { t } = useTranslation();
  return (
    <>
      <dt className="text-muted-foreground">{t("admin.queue.proof.reuse.title")}</dt>
      <dd>
        {matches.length === 0 ? (
          t("admin.queue.proof.reuse.gone")
        ) : (
          <ul className="flex flex-col gap-1">
            {matches.map((match) => {
              const label = t("admin.queue.proof.reuse.testimony", { name: match.displayName });
              return (
                <li key={match.testimonyId} className="break-words">
                  {match.href ? (
                    <a href={match.href} target="_blank" rel="noreferrer" className="font-semibold underline">
                      {label}
                    </a>
                  ) : (
                    <span className="font-semibold">{label}</span>
                  )}{" "}
                  · {t(`admin.queue.status.${match.status}`)} ·{" "}
                  {t(`admin.queue.proof.reuse.proofResult.${match.proofResult}`)}
                  <span className="block text-muted-foreground">
                    {t("admin.queue.proof.reuse.matchedOn", {
                      kinds: match.matchedOn.map((kind) => t(`admin.queue.proof.reuse.kind.${kind}`)).join(", "),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </dd>
    </>
  );
}

function OwnerFactsView({ ownerFacts }: { ownerFacts: QueueOwnerFacts }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { facts } = ownerFacts;
  const rows: Array<[string, string | undefined]> = [
    [t("claim.facts.name"), facts.name],
    [t("claim.facts.providerType"), t(`provider.type.${facts.providerType}`)],
    [t("claim.facts.region"), regionLabel(facts.region)],
    [t("claim.facts.address"), facts.address],
    [t("claim.facts.phone"), facts.phone],
    [t("claim.facts.whatsapp"), facts.whatsapp],
    [t("claim.facts.openingHours"), facts.openingHours],
    [t("claim.facts.services"), facts.services.map((code) => procedureLabel(code, language)).join(", ")],
  ];
  const flagged = new Set(ownerFacts.moderation?.flaggedSpans.map((span) => span.text) ?? []);
  return (
    <div className="flex flex-col gap-2">
      <ModerationLine moderation={ownerFacts.moderation} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={[...flagged].some((text) => value.includes(text)) ? "bg-highlight text-foreground" : ""}>
                {value}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

/** The moderated text with Gemini's flagged spans marked. */
function FlaggedText({ text, moderation }: { text: string; moderation: QueueModeration | null }) {
  const spans = [...(moderation?.flaggedSpans ?? [])]
    .filter((span) => span.start >= 0 && span.end <= text.length && span.start < span.end)
    .sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start < at) continue;
    parts.push(text.slice(at, span.start));
    parts.push(
      <mark key={span.start} title={span.ruleCode} className="rounded bg-highlight px-0.5 text-foreground">
        {text.slice(span.start, span.end)}
      </mark>,
    );
    at = span.end;
  }
  parts.push(text.slice(at));
  return <p className="whitespace-pre-line break-words">{parts}</p>;
}

function ContentView({ content, moderation }: { content: QueueTestimonyContent; moderation: QueueModeration | null }) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {content.displayName} · {t("provider.visitMonth", { month: formatVisitMonth(content.visitMonth, language) })}
        {content.procedureCode && <> · {procedureLabel(content.procedureCode, language)}</>}
        {content.pricePaidRupiah !== undefined && <> · {formatRupiah(content.pricePaidRupiah, language)}</>}
      </p>
      <dl className="flex flex-wrap gap-x-4 text-sm">
        {ASPECTS.map((aspect) => (
          <div key={aspect} className="flex gap-1">
            <dt className="text-muted-foreground">{t(`provider.aspects.${aspect}`)}</dt>
            <dd className="font-medium">{content.ratings[aspect]}/5</dd>
          </div>
        ))}
      </dl>
      <FlaggedText text={content.text} moderation={moderation} />
      {content.photoUrls.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {content.photoUrls.map((url, index) => {
            const flagged = moderation?.flaggedPhotos?.find((photo) => photo.photoIndex === index);
            return (
              <li key={url} className="flex flex-col gap-1 text-xs">
                <a href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    alt={t("admin.queue.photo", { number: index + 1 })}
                    className={`h-24 w-24 rounded-md object-cover ${flagged ? "ring-2 ring-destructive" : ""}`}
                  />
                </a>
                {flagged && <span className="text-destructive">{flagged.ruleCode}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TestimonyView({ testimony }: { testimony: QueueTestimony }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { moderation } = testimony;
  return (
    <div className="flex flex-col gap-3">
      <ModerationLine moderation={moderation} />
      {testimony.revision ? (
        <>
          <h3 className="font-medium">{t("admin.queue.revision")}</h3>
          <ContentView content={testimony.revision} moderation={moderation} />
          <details>
            <summary className="cursor-pointer text-sm">{t("admin.queue.publicVersion")}</summary>
            <ContentView content={testimony} moderation={null} />
          </details>
        </>
      ) : (
        <ContentView content={testimony} moderation={moderation} />
      )}
      {testimony.status === "published" && (
        <a href={providerPath(testimony.placeId)} className="text-sm underline">
          {t("admin.queue.viewPublic")}
        </a>
      )}
      <details>
        <summary className="cursor-pointer text-sm">{t("admin.queue.history")}</summary>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {testimony.history.map((entry) => (
            <li key={`${entry.at}-${entry.kind}-${entry.label}`}>
              {formatTime(entry.at, language)} · {t(`admin.queue.historyKind.${entry.kind}`)}: {entry.label}
              {entry.detail && <> · {entry.detail}</>}
              {entry.by && <> · {entry.by}</>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** Testimony actions the item offers, in the order the admin usually needs them. */
function testimonyActions(item: QueueItem): TestimonyAction[] {
  const status = item.testimony?.status;
  // A proof review decides the proof only; the Testimony has its own queue items.
  if (item.kind === "proofReview") return [];
  if (item.kind === "held" || item.kind === "revision") return ["publish", "reject", "sendBackToAuthor"];
  if (status === "hidden") return ["publish", "remove"];
  if (status === "published") return ["hide", "remove"];
  return [];
}

function Actions({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        {testimonyActions(item).map((action) => (
          <ActionButton key={action} request={{ action, subjectId: item.subjectId }} />
        ))}
        {item.kind === "proofReview" && (
          <>
            <ActionButton request={{ action: "acceptProof", subjectId: item.subjectId }} />
            <ActionButton request={{ action: "rejectProof", subjectId: item.subjectId }} />
          </>
        )}
        {item.kind === "spotCheck" && <ActionButton request={{ action: "spotCheckConfirm", subjectId: item.id }} />}
        {item.kind === "claim" && (
          <>
            <ActionButton request={{ action: "approveClaim", subjectId: item.subjectId }} />
            <ActionButton request={{ action: "rejectClaim", subjectId: item.subjectId }} />
          </>
        )}
        {item.kind === "ownerFacts" && (
          <>
            <ActionButton request={{ action: "publishOwnerFacts", subjectId: item.subjectId }} />
            <ActionButton request={{ action: "rejectOwnerFacts", subjectId: item.subjectId }} />
          </>
        )}
        {item.kind === "reply" && (
          <>
            <ActionButton request={{ action: "publishReply", subjectId: item.subjectId }} />
            <ActionButton request={{ action: "rejectReply", subjectId: item.subjectId }} />
          </>
        )}
        {item.testimony && item.kind === "held" && (item.testimony.moderation?.detectionRuleCodes?.length ?? 0) > 0 && (
          <OpenViolation
            placeId={item.testimony.placeId}
            since={item.createdAt}
            evidence={{ detectionHoldIds: [item.testimony.id] }}
          />
        )}
        {item.violation && <ViolationActions id={item.subjectId} violation={item.violation} />}
        {item.kind === "nameCorrection" && (
          <>
            <ActionButton request={{ action: "applyNameCorrection", subjectId: item.id }} />
            <ActionButton request={{ action: "dismissNameCorrection", subjectId: item.id }} />
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("admin.queue.logged")}</p>
    </div>
  );
}

/** One admin action. Actions that need a reason open a reason field first. */
function ActionButton({
  request,
  reasonLabel,
  disabled = false,
}: {
  request: Omit<AdminActionRequest, "reason">;
  /** Replaces the default reason prompt, e.g. to ask for the phone contact. */
  reasonLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const id = useId();
  const needsReason = REASON_REQUIRED.has(request.action);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t(`admin.queue.actions.${request.action}`);
  const destructive = [
    "remove",
    "reject",
    "rejectProof",
    "rejectClaim",
    "revokeClaim",
    "rejectOwnerFacts",
    "rejectReply",
  ].includes(request.action);
  const primary = ["publish", "acceptProof", "approveClaim", "publishOwnerFacts", "publishReply"].includes(
    request.action,
  );

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: AdminActionRequest = { ...request, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      const response = await fetch("/admin/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        setAsking(false);
        await revalidator.revalidate();
        return;
      }
      const failure = (await response.json().catch(() => null)) as AdminApiError | null;
      setError(failure?.message ?? t("admin.queue.failed"));
    } catch {
      setError(t("admin.queue.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (needsReason && asking) {
    return (
      <div className="flex w-full flex-col gap-2 rounded-md border p-2">
        <label htmlFor={id} className="text-sm font-medium">
          {reasonLabel ?? t("admin.queue.reasonFor", { action: label })}
        </label>
        <Textarea
          id={id}
          value={reason}
          maxLength={ADMIN_REASON_MAX_CHARS}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-16"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={destructive ? "danger" : "primary"}
            disabled={busy || !reason.trim()}
            onClick={send}
          >
            {label}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsking(false)}>
            {t("report.cancel")}
          </Button>
        </div>
        {error && <FieldError role="alert">{error}</FieldError>}
      </div>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        variant={destructive ? "danger" : primary ? "primary" : "outline"}
        disabled={busy || disabled}
        onClick={needsReason ? () => setAsking(true) : send}
      >
        {label}
      </Button>
      {error && <FieldError role="alert">{error}</FieldError>}
    </span>
  );
}

/** The Testimony Policy Violation case: evidence, notice, the Provider's response and the window. */
function ViolationView({ violation }: { violation: QueuePolicyViolation }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { evidence, suspectedPeriod } = violation;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t("admin.queue.violation.provider")}</dt>
      <dd>
        <a href={providerPath(violation.placeId)} className="underline">
          {violation.providerName || violation.placeId}
        </a>{" "}
        · {violation.claimed ? t("admin.queue.violation.claimed") : t("admin.queue.violation.unclaimed")}
      </dd>
      <dt className="text-muted-foreground">{t("admin.queue.violation.status")}</dt>
      <dd>
        <Badge variant={violation.status === "open" ? "outline" : "warning"}>
          {t(`admin.queue.violation.statusValue.${violation.status}`)}
        </Badge>
      </dd>
      <dt className="text-muted-foreground">{t("admin.queue.violation.period")}</dt>
      <dd>
        {suspectedPeriod.from} - {suspectedPeriod.to}
      </dd>
      <dt className="text-muted-foreground">{t("admin.queue.violation.evidence")}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <span>
          {t("admin.queue.violation.reports", { count: evidence.reportIds.length })}
          {evidence.reportIds.length > 0 && <IdList ids={evidence.reportIds} />}
        </span>
        <span>
          {t("admin.queue.violation.holds", { count: evidence.detectionHoldIds.length })}
          {evidence.detectionHoldIds.length > 0 && <IdList ids={evidence.detectionHoldIds} />}
        </span>
        <span>{t("admin.queue.violation.privateFiles", { count: evidence.privateEvidenceCount })}</span>
        {evidence.notes && <span className="whitespace-pre-line break-words">{evidence.notes}</span>}
      </dd>
      {!violation.claimed && (
        <>
          <dt className="text-muted-foreground">{t("admin.queue.claim.googlePhone")}</dt>
          <dd>
            {violation.googlePhone ? (
              <a href={`tel:${violation.googlePhone.replace(/[^\d+]/g, "")}`} className="font-semibold underline">
                {violation.googlePhone}
              </a>
            ) : (
              t("admin.queue.claim.noGooglePhone")
            )}
            {violation.googleDisplayName && (
              <span className="text-muted-foreground"> · {violation.googleDisplayName}</span>
            )}
          </dd>
          <dd className="col-span-2 text-xs text-muted-foreground">{t("admin.queue.violation.phoneHint")}</dd>
        </>
      )}
      {violation.notifiedVia && (
        <>
          <dt className="text-muted-foreground">{t("admin.queue.violation.notifiedVia")}</dt>
          <dd>
            {t(`admin.queue.violation.via.${violation.notifiedVia}`)}
            {violation.phoneContactNote && (
              <span className="block whitespace-pre-line break-words text-muted-foreground">
                {violation.phoneContactNote}
              </span>
            )}
          </dd>
        </>
      )}
      {violation.responseDueAt && (
        <>
          <dt className="text-muted-foreground">{t("admin.queue.violation.responseDue")}</dt>
          <dd>
            {formatTime(violation.responseDueAt, language)} ·{" "}
            <strong className={violation.windowOver ? "text-destructive" : ""}>
              {violation.windowOver ? t("admin.queue.violation.windowOver") : t("admin.queue.violation.windowOpen")}
            </strong>
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">{t("admin.queue.violation.response")}</dt>
      <dd>
        {violation.providerResponse ? (
          <>
            <span className="block whitespace-pre-line break-words">{violation.providerResponse.text}</span>
            <span className="text-muted-foreground">
              {formatTime(violation.providerResponse.respondedAt, language)}
            </span>
          </>
        ) : (
          t("admin.queue.violation.noResponse")
        )}
      </dd>
    </dl>
  );
}

function IdList({ ids }: { ids: string[] }) {
  return <span className="block break-all font-mono text-xs text-muted-foreground">{ids.join(", ")}</span>;
}

/** Notify and dismiss while `open`; confirm (after the window) and dismiss once notified. */
function ViolationActions({ id, violation }: { id: string; violation: QueuePolicyViolation }) {
  const { t } = useTranslation();
  if (violation.status === "open") {
    return (
      <>
        <ActionButton
          request={{ action: "notifyViolation", subjectId: id }}
          reasonLabel={violation.claimed ? undefined : t("admin.queue.violation.phoneReasonLabel")}
        />
        <ActionButton request={{ action: "dismissViolation", subjectId: id }} />
      </>
    );
  }
  return (
    <>
      <span className="flex flex-col gap-1">
        <ActionButton request={{ action: "confirmViolation", subjectId: id }} disabled={!violation.windowOver} />
        {!violation.windowOver && (
          <span className="text-xs text-muted-foreground">{t("admin.queue.violation.confirmWait")}</span>
        )}
      </span>
      <ActionButton request={{ action: "dismissViolation", subjectId: id }} />
    </>
  );
}

/** Jakarta calendar date `YYYY-MM-DD` of a time. */
function jakartaDate(ms: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(ms));
}

const SUSPECTED_PERIOD_DEFAULT_DAYS = 30;
const DATE_INPUT =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-base text-foreground shadow-xs focus-visible:border-primary";

/** Opens a case for a place from a report or a detection hold, with that evidence prefilled. */
function OpenViolation({
  placeId,
  since,
  evidence,
}: {
  placeId: string;
  /** The item's createdAt; the period starts 30 days before it. */
  since: string;
  evidence: { reportIds?: string[]; detectionHoldIds?: string[] };
}) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() =>
    jakartaDate(new Date(since).getTime() - SUSPECTED_PERIOD_DEFAULT_DAYS * 86_400_000),
  );
  const [to, setTo] = useState(() => jakartaDate(Date.now()));
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: AdminActionRequest = {
        action: "openViolation",
        subjectId: placeId,
        reason: reason.trim(),
        violation: {
          reportIds: [],
          detectionHoldIds: [],
          ...evidence,
          suspectedFrom: from,
          suspectedTo: to,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      };
      const response = await fetch("/admin/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        setOpen(false);
        await revalidator.revalidate();
        return;
      }
      const failure = (await response.json().catch(() => null)) as AdminApiError | null;
      setError(failure?.message ?? t("admin.queue.failed"));
    } catch {
      setError(t("admin.queue.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("admin.queue.violation.open")}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border p-2">
      <p className="text-sm font-medium">{t("admin.queue.violation.openTitle")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={`${id}-from`} className="flex flex-col gap-1 text-sm">
          {t("admin.queue.violation.periodFrom")}
          <input
            className={DATE_INPUT}
            id={`${id}-from`}
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-to`} className="flex flex-col gap-1 text-sm">
          {t("admin.queue.violation.periodTo")}
          <input
            className={DATE_INPUT}
            id={`${id}-to`}
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      <label htmlFor={`${id}-notes`} className="text-sm font-medium">
        {t("admin.queue.violation.notes")}
      </label>
      <Textarea
        id={`${id}-notes`}
        value={notes}
        maxLength={ADMIN_REASON_MAX_CHARS}
        onChange={(event) => setNotes(event.target.value)}
        className="min-h-16"
      />
      <label htmlFor={`${id}-reason`} className="text-sm font-medium">
        {t("admin.queue.reasonFor", { action: t("admin.queue.actions.openViolation") })}
      </label>
      <Textarea
        id={`${id}-reason`}
        value={reason}
        maxLength={ADMIN_REASON_MAX_CHARS}
        onChange={(event) => setReason(event.target.value)}
        className="min-h-16"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy || !reason.trim() || !from || !to} onClick={send}>
          {t("admin.queue.actions.openViolation")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          {t("report.cancel")}
        </Button>
      </div>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
