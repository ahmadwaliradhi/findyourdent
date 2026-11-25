// Detection (spec 09 part 2): checks run at submission, after Moderation returned
// `publish`, that can only turn it into `hold`. Pure; the caller reads Firestore.
// The rule codes and thresholds are for admins only: never in an author's response.
import type { DetectionRuleCode } from "@findyourdent/contracts/firestore";
import type { SubmissionSignalHashes } from "./submission-signals.ts";

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

/** An earlier submission's signal for the same Provider. */
export interface OtherSignal extends SubmissionSignalHashes {
  authorUid: string;
}

/** An earlier signal with the Testimony it belongs to. */
export interface LinkedSignal extends OtherSignal {
  testimonyId: string;
}

/** Which hash another signal shares with a device. */
export interface DeviceMatch {
  sharedIp: boolean;
  sharedBrowser: boolean;
}

/**
 * The one match predicate of D3: whether `other` shares the IP hash or the browser-id hash
 * with any of `mine` (a Testimony's signals: its submission and each edit), and which.
 */
export function sharesDevice(mine: readonly SubmissionSignalHashes[], other: SubmissionSignalHashes): DeviceMatch {
  return {
    sharedIp: mine.some((signal) => signal.ipHash === other.ipHash),
    sharedBrowser: mine.some((signal) => signal.browserIdHash === other.browserIdHash),
  };
}

/** Another account's Testimony that shares a hash with this device, and which hash it shares. */
export interface SharedDeviceLink extends DeviceMatch {
  testimonyId: string;
  authorUid: string;
}

/**
 * The other accounts' Testimonies for the Provider with a signal that shares an IP hash or
 * browser-id hash with this device, one link per Testimony (what its signals share is OR-ed),
 * in the order its first matching signal appears. The author's own signals never count.
 */
export function sharedDeviceLinks(
  mine: readonly SubmissionSignalHashes[],
  others: readonly LinkedSignal[],
  authorUid: string,
): SharedDeviceLink[] {
  const links = new Map<string, SharedDeviceLink>();
  for (const other of others) {
    if (other.authorUid === authorUid) continue;
    const { sharedIp, sharedBrowser } = sharesDevice(mine, other);
    if (!sharedIp && !sharedBrowser) continue;
    const known = links.get(other.testimonyId);
    links.set(other.testimonyId, {
      testimonyId: other.testimonyId,
      authorUid: other.authorUid,
      sharedIp: (known?.sharedIp ?? false) || sharedIp,
      sharedBrowser: (known?.sharedBrowser ?? false) || sharedBrowser,
    });
  }
  return [...links.values()];
}

/** D3 sharedDevice: whether another account's submission for the same Provider shares a hash. */
export function sharedDeviceFires(
  mine: SubmissionSignalHashes,
  others: readonly OtherSignal[],
  authorUid: string,
): boolean {
  return others.some((other) => {
    const { sharedIp, sharedBrowser } = sharesDevice([mine], other);
    return other.authorUid !== authorUid && (sharedIp || sharedBrowser);
  });
}

/** What detection looks at for one submission. */
export interface DetectionInput {
  otherSubmittedAtMs: readonly number[];
  nowMs: number;
  /** This submission's device and the Provider's earlier signals; D3 is skipped without it. */
  sharedDevice?: { mine: SubmissionSignalHashes; others: readonly OtherSignal[]; authorUid: string };
}

/** The detection triggers this submission fires, in rule order; empty when it may publish. */
export function detectionRuleCodes(input: DetectionInput): DetectionRuleCode[] {
  const codes: DetectionRuleCode[] = [];
  if (velocityFires(input.otherSubmittedAtMs, input.nowMs)) codes.push("D1");
  const device = input.sharedDevice;
  if (device && sharedDeviceFires(device.mine, device.others, device.authorUid)) codes.push("D3");
  return codes;
}
