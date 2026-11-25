// Testimony Policy Violation cases (spec 09 part 2): the response window and the
// pure move rule. Plain, so the server and the admin page share one source.
import type { PolicyViolationStatus } from "@findyourdent/contracts/firestore";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A Provider has this many days to respond after being notified, before an admin may confirm. */
export const VIOLATION_RESPONSE_DAYS = 7;

export const VIOLATION_MOVES = ["notifyViolation", "confirmViolation", "dismissViolation"] as const;
export type ViolationMove = (typeof VIOLATION_MOVES)[number];

const TARGET: Record<ViolationMove, PolicyViolationStatus> = {
  notifyViolation: "providerNotified",
  confirmViolation: "confirmed",
  dismissViolation: "dismissed",
};

const FROM: Record<ViolationMove, readonly PolicyViolationStatus[]> = {
  notifyViolation: ["open"],
  confirmViolation: ["providerNotified"],
  dismissViolation: ["open", "providerNotified"],
};

/**
 * The status a move leads to, or null when it is refused. Confirming needs the response
 * window over: `nowMs` >= `responseDueMs`.
 */
export function nextViolationStatus(
  move: ViolationMove,
  from: PolicyViolationStatus,
  clock: { nowMs: number; responseDueMs?: number },
): PolicyViolationStatus | null {
  if (!FROM[move].includes(from)) return null;
  if (move === "confirmViolation" && (clock.responseDueMs === undefined || clock.nowMs < clock.responseDueMs)) {
    return null;
  }
  return TARGET[move];
}

/** The longest response a Provider may write to a case, in characters. */
export const VIOLATION_RESPONSE_MAX_CHARS = 2000;

/**
 * A case as its Provider sees it on the owner pages. Nothing of the evidence is here
 * (report ids, detection holds, notes, private files): detection rules stay secret
 * (spec 09). `open` cases are not shown, the Provider has not been notified yet.
 */
export interface OwnerViolation {
  id: string;
  status: Exclude<PolicyViolationStatus, "open">;
  /** Jakarta dates `YYYY-MM-DD`. */
  suspectedPeriod: { from: string; to: string };
  notifiedAt?: string;
  /** End of the 7-day response window, ISO. */
  responseDueAt?: string;
  /** Only while the case is `providerNotified`. */
  canRespond: boolean;
  providerResponse?: { text: string; respondedAt: string };
  /** The team's reason, once the case is confirmed or dismissed. */
  decisionReason?: string;
}

/** POST /api/providers/:placeId/policy-violations/:violationId/response, JSON. A later response replaces the earlier one. */
export interface ViolationResponseSubmission {
  text: string;
}

/** 200 body of a saved response. */
export interface ViolationResponseResult {
  status: "saved";
  respondedAt: string;
  message: string;
}
