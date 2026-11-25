import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { isLanguage } from "~/i18n/config";
import { formatDate } from "~/lib/format";
import { TRANSPARENCY_PAGE_PATH } from "~/lib/paths";

/**
 * The label every published Testimony carries (spec 09): "Kunjungan terbukti" for a
 * Proven Testimony, otherwise "Belum terbukti", linked to the page that explains why
 * it does not count.
 */
export function ProofLabel({ verifiedVisit }: { verifiedVisit: boolean }) {
  const { t } = useTranslation();
  if (verifiedVisit) return <Badge variant="success">{t("proof.verified")}</Badge>;
  return (
    <Link
      to={TRANSPARENCY_PAGE_PATH}
      className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      title={t("proof.unverifiedHint")}
    >
      <Badge variant="outline">{t("proof.unverified")}</Badge>
      <span className="sr-only">: {t("proof.unverifiedHint")}</span>
    </Link>
  );
}

/** In place of star averages below three Proven Testimonies (spec 09). */
export function NotEnoughProven({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={className}>
      <span className="font-semibold">{t("proof.notEnough")}</span>
      <span className="text-muted-foreground"> · {t("proof.provenCount", { count })}</span>
    </p>
  );
}

/** Shown next to the proof label of a Testimony left out of the score by a confirmed violation (spec 09 Part 2). */
export function ExcludedLabel({ excluded }: { excluded: boolean }) {
  const { t } = useTranslation();
  if (!excluded) return null;
  return <Badge variant="warning">{t("violation.excluded")}</Badge>;
}

/** "Pelanggaran kebijakan testimoni" with its end date, on the Provider page and directory rows. */
export function ViolationBadge({ until }: { until: string }) {
  const { t, i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : "id";
  return (
    <Badge variant="danger" data-testid="violation-badge">
      {t("violation.badge")} · {t("violation.until", { date: formatDate(until.slice(0, 10), language) })}
    </Badge>
  );
}
