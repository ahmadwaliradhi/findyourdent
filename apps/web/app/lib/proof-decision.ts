// The Proof of Visit decision (spec 09, ADR-0011): a pure function of the facts the
// agent read from the proof, the stated visit month, today in Asia/Jakarta and the
// reuse check. The agent applies no date window and never decides; this does.
//
// Types only from the contracts, no `~` alias: the admin sweep (spec 09) runs from the
// Cloud Run job image, which copies app/lib/ unbundled.
import type { ProofExtraction } from "@findyourdent/contracts";
import type { ProofOfVisitRecord, ProofPendingReason, ProofRejectedReason } from "@findyourdent/contracts/firestore";

/** A proof dated more than this many months before today is not accepted (spec 09). */
export const PROOF_MAX_AGE_MONTHS = 12;
/** A proof month further than this from the stated visit month waits for an admin. */
export const PROOF_VISIT_MONTH_TOLERANCE = 1;
/**
 * Proofs checked per Testimony, at submission, with an edit or attached later (spec 09),
 * so a buzzer cannot try fake receipts until one passes. A proof the agent could not
 * read is no attempt.
 */
export const MAX_PROOF_ATTEMPTS = 3;

/**
 * Whether the proof matches another Testimony's Proof Fingerprint at the same Provider
 * (app/server/proof-fingerprint.server.ts: same key, same PDF, or a near-identical image).
 */
export interface ReuseCheck {
  matched: boolean;
}
export const NO_REUSE: ReuseCheck = { matched: false };

export type ProofDecision =
  | { result: "accepted" }
  | { result: "pending"; reasons: ProofPendingReason[] }
  | { result: "rejected"; reason: "unreadable" | "notAProof" | "tooOld" };

export interface ProofDecisionInput {
  extraction: ProofExtraction;
  /** The visit month the author stated, YYYY-MM. */
  visitMonth: string;
  /** Today in Asia/Jakarta, YYYY-MM-DD. */
  today: string;
  reuse?: ReuseCheck;
}

/**
 * Not readable or not a proof: rejected. Older than 12 months: rejected. Otherwise every
 * doubt (name, date, reuse) sends it to an admin, and with none it is accepted. A missing
 * total is fine; a missing date is a date doubt.
 */
export function decideProof({ extraction, visitMonth, today, reuse = NO_REUSE }: ProofDecisionInput): ProofDecision {
  if (!extraction.readable) return { result: "rejected", reason: "unreadable" };
  if (!extraction.isProofOfVisit) return { result: "rejected", reason: "notAProof" };
  const { proofDate } = extraction;
  // A month-only date gets the benefit of the doubt: it may be that month's last day.
  if (proofDate && latestDay(proofDate) < monthsBefore(today, PROOF_MAX_AGE_MONTHS)) {
    return { result: "rejected", reason: "tooOld" };
  }
  const reasons: ProofPendingReason[] = [];
  if (!extraction.clinicNameMatches) reasons.push("nameMismatch");
  if (!proofDate || Math.abs(monthIndex(proofDate) - monthIndex(visitMonth)) > PROOF_VISIT_MONTH_TOLERANCE) {
    reasons.push("dateMismatch");
  }
  if (reuse.matched) reasons.push("possibleReuse");
  return reasons.length > 0 ? { result: "pending", reasons } : { result: "accepted" };
}

/**
 * What the author is told about their Proof of Visit (spec 09 user story 10). A pending
 * proof gives no reasons: the author only learns the team is checking it.
 * `notChecked`: the agent could not read it this time; the file was deleted.
 */
export type ProofOfVisitStatus =
  | { result: "accepted" }
  | { result: "pending" }
  /** `adminReason`: the admin's note when the team turned it down. */
  | { result: "rejected"; reason?: ProofRejectedReason; adminReason?: string }
  | { result: "notChecked" };

/** The author's view of a stored (or just decided) result. */
export function proofStatusForAuthor(
  proof: Pick<ProofOfVisitRecord, "result"> & { reason?: ProofRejectedReason; adminReason?: string },
): ProofOfVisitStatus {
  if (proof.result !== "rejected") return { result: proof.result };
  return {
    result: "rejected",
    ...(proof.reason ? { reason: proof.reason } : {}),
    ...(proof.adminReason ? { adminReason: proof.adminReason } : {}),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Months since year 0 of a YYYY-MM or YYYY-MM-DD date, so two months subtract. */
function monthIndex(date: string): number {
  const [year, month] = date.split("-").map(Number) as [number, number];
  return year * 12 + (month - 1);
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The last day a YYYY-MM-DD or YYYY-MM date can mean, as YYYY-MM-DD. */
function latestDay(date: string): string {
  if (date.length > 7) return date;
  const [year, month] = date.split("-").map(Number) as [number, number];
  return `${date}-${pad(daysIn(year, month))}`;
}

/** The same day `months` calendar months earlier, clamped to the end of a shorter month. */
function monthsBefore(day: string, months: number): string {
  const index = monthIndex(day) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const date = Number(day.slice(8, 10));
  return `${year}-${pad(month)}-${pad(Math.min(date, daysIn(year, month)))}`;
}
