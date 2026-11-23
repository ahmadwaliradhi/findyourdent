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

const isMonthOnly = (date: string) => date.length === 7;

/**
 * More than 12 months before today. A full date is compared by day (today's day 12 months
 * back is still in time); a month-only date by month, which gives it the benefit of the doubt.
 */
function isTooOld(proofDate: string, today: string): boolean {
  const monthsBack = monthIndex(today) - monthIndex(proofDate);
  if (isMonthOnly(proofDate) || monthsBack !== PROOF_MAX_AGE_MONTHS) return monthsBack > PROOF_MAX_AGE_MONTHS;
  return proofDate.slice(8) < today.slice(8);
}

/** Dated after today: a month-only date only when its month is still to come. */
function isInFuture(proofDate: string, today: string): boolean {
  return isMonthOnly(proofDate) ? monthIndex(proofDate) > monthIndex(today) : proofDate > today;
}

/**
 * Decides a Proof of Visit. `extraction` is absent when the agent's check did not run
 * (error, timeout, invalid answer): the file may be fine, so the admin looks (`notChecked`)
 * instead of the author being told it is unreadable.
 * `visitMonth` is `YYYY-MM`; `today` is `YYYY-MM-DD` in Asia/Jakarta. `reuse`: the reuse
 * check found another Testimony's matching Proof Fingerprint, which never rejects on its
 * own because the other Testimony may be the reused one.
 */
export function decideProof(
  extraction: ProofOfVisitExtraction | undefined,
  { visitMonth, today, reuse }: { visitMonth: string; today: string; reuse: boolean },
): ProofDecision {
  const reuseReasons: ProofPendingReason[] = reuse ? ["possibleReuse"] : [];
  if (!extraction) return { result: "pending", reasons: ["notChecked", ...reuseReasons] };
  if (!extraction.readable) return { result: "rejected", reason: "unreadable" };
  if (!extraction.isProofOfVisit) return { result: "rejected", reason: "notAProof" };
  const { proofDate } = extraction;
  if (proofDate && isTooOld(proofDate, today)) return { result: "rejected", reason: "tooOld" };

  const reasons: ProofPendingReason[] = [];
  if (!extraction.clinicNameMatches) reasons.push("nameMismatch");
  // A proof with no readable date cannot show the visit month, and one dated after today
  // cannot be a past visit, so the admin looks.
  if (
    !proofDate ||
    isInFuture(proofDate, today) ||
    Math.abs(monthIndex(proofDate) - monthIndex(visitMonth)) > PROOF_VISIT_MONTH_TOLERANCE
  ) {
    reasons.push("dateMismatch");
  }
  reasons.push(...reuseReasons);
  return reasons.length > 0 ? { result: "pending", reasons } : { result: "accepted" };
}
