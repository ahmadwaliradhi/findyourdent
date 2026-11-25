import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { ExcludedLabel } from "~/components/violation-badge";
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

/** A published Testimony's labels: its proof label, and the exclusion label when a confirmed violation covers it. */
export function TestimonyLabels({
  verifiedVisit,
  excludedByViolation,
}: {
  verifiedVisit: boolean;
  excludedByViolation: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ProofLabel verifiedVisit={verifiedVisit} />
      <ExcludedLabel excluded={excludedByViolation} />
    </span>
  );
}
