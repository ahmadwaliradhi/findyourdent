// The Proof of Visit decision (spec 09, ADR-0011): a pure function of what the agent read
// off the proof, the stated visit month and today's date in Asia/Jakarta. The agent only
// reports facts; every rule about names and dates lives here.
import type { ProofOfVisitExtraction } from "@findyourdent/contracts";
import type { ProofPendingReason, ProofRejectedReason } from "@findyourdent/contracts/firestore";

/** A proof dated more than this many months before today is too old. */
export const PROOF_MAX_AGE_MONTHS = 12;
/** A proof may be dated this many months either side of the stated visit month. */
export const PROOF_VISIT_MONTH_TOLERANCE = 1;

export type ProofDecision =
  | { result: "accepted" }
  | { result: "pending"; reasons: ProofPendingReason[] }
  | { result: "rejected"; reason: ProofRejectedReason };

/** Months since year 0 of a `YYYY-MM` or `YYYY-MM-DD` date. */
function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/**
 * More than 12 months before today. A full date is compared by day (today's date a year
 * back is still in time); a month-only date by month, which gives it the benefit of the doubt.
 */
function isTooOld(proofDate: string, today: string): boolean {
  if (proofDate.length === 7) return monthIndex(today) - monthIndex(proofDate) > PROOF_MAX_AGE_MONTHS;
  const limit = `${Number(today.slice(0, 4)) - PROOF_MAX_AGE_MONTHS / 12}${today.slice(4)}`;
  return proofDate < limit;
}

/**
 * Decides a Proof of Visit. `extraction` is absent when the agent's check did not run
 * (error, timeout, invalid answer): nothing was read, so it is `unreadable`.
 * `visitMonth` is `YYYY-MM`; `today` is `YYYY-MM-DD` in Asia/Jakarta.
 */
export function decideProof(
  extraction: ProofOfVisitExtraction | undefined,
  { visitMonth, today }: { visitMonth: string; today: string },
): ProofDecision {
  if (!extraction?.readable) return { result: "rejected", reason: "unreadable" };
  if (!extraction.isProofOfVisit) return { result: "rejected", reason: "notAProof" };
  const { proofDate } = extraction;
  if (proofDate && isTooOld(proofDate, today)) return { result: "rejected", reason: "tooOld" };

  const reasons: ProofPendingReason[] = [];
  if (!extraction.clinicNameMatches) reasons.push("nameMismatch");
  // A proof with no readable date cannot show the visit month, so the admin looks.
  if (!proofDate || Math.abs(monthIndex(proofDate) - monthIndex(visitMonth)) > PROOF_VISIT_MONTH_TOLERANCE) {
    reasons.push("dateMismatch");
  }
  return reasons.length > 0 ? { result: "pending", reasons } : { result: "accepted" };
}
