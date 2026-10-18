// What a Testimony's Proof of Visit means for the score (spec 09, ADR-0011): each
// Testimony is labelled Proven or not, and a Provider without enough Proven
// Testimonies shows no star average.
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { VERIFICATION_PATH } from "~/lib/paths";

/** "Kunjungan terbukti", or "Belum terbukti" linking to the page that explains why it does not count. */
export function ProofLabel({ proven }: { proven: boolean }) {
  const { t } = useTranslation();
  if (proven) return <Badge variant="success">{t("proof.proven")}</Badge>;
  return (
    <Link
      to={VERIFICATION_PATH}
      className="-my-2.5 inline-flex min-h-touch items-center rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Badge variant="outline" icon={CircleHelp} className="underline-offset-2 hover:underline">
        {t("proof.unproven")}
        <span className="sr-only">: {t("nav.verification")}</span>
      </Badge>
    </Link>
  );
}

/** In place of a star average: "Belum cukup testimoni terbukti" and how many there are. */
export function NotEnoughProven({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={className}>
      <span className="font-semibold text-foreground">{t("proof.notEnough")}</span>
      {" · "}
      <span className="whitespace-nowrap">{t("proof.provenCount", { count })}</span>
    </p>
  );
}
