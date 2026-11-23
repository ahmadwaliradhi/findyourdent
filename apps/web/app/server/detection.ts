// Detection (spec 09 part 2): checks run at submission, after Moderation returned
// `publish`, that can only turn it into `hold`. Pure; the caller reads Firestore.
// The rule codes and thresholds are for admins only: never in an author's response.
import type { DetectionRuleCode } from "@findyourdent/contracts/firestore";

export type { DetectionRuleCode };

const HOUR_MS = 60 * 60 * 1000;

/** D1: this many Testimonies for one Provider within VELOCITY_DAY_WINDOW_MS, counting this one. */
export const VELOCITY_DAY_THRESHOLD = 3;
export const VELOCITY_DAY_WINDOW_MS = 24 * HOUR_MS;
/** D1: this many Testimonies for one Provider within VELOCITY_WEEK_WINDOW_MS, counting this one. */
export const VELOCITY_WEEK_THRESHOLD = 5;
export const VELOCITY_WEEK_WINDOW_MS = 7 * 24 * HOUR_MS;

/** How far back the caller reads a Provider's Testimonies: the longest window. */
export const DETECTION_LOOKBACK_MS = VELOCITY_WEEK_WINDOW_MS;

/**
 * D1 velocity: whether this submission makes a burst for its Provider. `otherSubmittedAtMs`:
 * when the Provider's other Testimonies (not deleted) were submitted. A Testimony counts
 * when it is less than the window old; one stamped slightly after `nowMs` counts too.
 */
export function velocityFires(otherSubmittedAtMs: readonly number[], nowMs: number): boolean {
  const within = (windowMs: number) => otherSubmittedAtMs.filter((at) => nowMs - at < windowMs).length + 1;
  return (
    within(VELOCITY_DAY_WINDOW_MS) >= VELOCITY_DAY_THRESHOLD ||
    within(VELOCITY_WEEK_WINDOW_MS) >= VELOCITY_WEEK_THRESHOLD
  );
}

/** What detection looks at for one submission. */
export interface DetectionInput {
  otherSubmittedAtMs: readonly number[];
  nowMs: number;
}

/** The detection triggers this submission fires, in rule order; empty when it may publish. */
export function detectionRuleCodes(input: DetectionInput): DetectionRuleCode[] {
  const codes: DetectionRuleCode[] = [];
  if (velocityFires(input.otherSubmittedAtMs, input.nowMs)) codes.push("D1");
  return codes;
}
