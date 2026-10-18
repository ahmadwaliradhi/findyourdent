// What the author reads about their Proof of Visit (spec 09 user stories 10, 11 and 17):
// right after "Kirim" and on "Testimoni saya". Plain words only: a waiting proof never
// says why it waits.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ProofOfVisitStatus } from "~/lib/proof-decision";
import { cn } from "~/lib/utils";

export function proofStatusMessage(t: TFunction, status: ProofOfVisitStatus): string {
  if (status.result !== "rejected") return t(`proofStatus.${status.result}`);
  return `${t(`proofStatus.rejected.${status.reason ?? "other"}`)} ${t("proofStatus.tryAnother")}`;
}

const TONE: Record<ProofOfVisitStatus["result"], string> = {
  accepted: "border-success-line bg-success-soft",
  pending: "border-info-line bg-info-soft",
  rejected: "border-warning-line bg-warning-soft",
  notChecked: "border-warning-line bg-warning-soft",
};

/** The proof status as a labelled note; the label and words carry it, never colour alone. */
export function ProofStatusNote({ status, className }: { status: ProofOfVisitStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("flex flex-col gap-1 rounded-md border px-4 py-3 text-sm", TONE[status.result], className)}>
      <span className="font-semibold">{t("proofStatus.title")}</span>
      <span>{proofStatusMessage(t, status)}</span>
    </p>
  );
}
