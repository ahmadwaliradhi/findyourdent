// Testimony Policy Violation cases (spec 09 part 2): the response window and the
// pure move rule. Plain, so the server and the admin page share one source.
import type { PolicyViolationStatus } from "@findyourdent/contracts/firestore";

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
