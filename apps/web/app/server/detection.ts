// Detection (spec 09 part 2): checks run at submission, after Moderation returned
// `publish`, that can only turn it into `hold`. Pure; the caller reads Firestore.
// The rule codes and thresholds are for admins only: never in an author's response.
import type { DetectionRuleCode, TestimonyStatus } from "@findyourdent/contracts/firestore";
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

/** D2 compares a new Testimony with the Provider's Testimonies in these statuses. */
export const SIMILARITY_COMPARED_STATUSES = ["published", "held"] as const satisfies readonly TestimonyStatus[];

/** D2: a Testimony this similar or more to another for the same Provider is held. */
export const SIMILARITY_THRESHOLD = 0.8;

/** Lower case, NFKC, whitespace runs as one space: a template reworded only in those still matches. */
function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function trigrams(text: string): Set<string> {
  const chars = [...normalized(text)];
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(""));
  return grams;
}

/**
 * D2: character-trigram Jaccard similarity of two texts, from 0 to 1: the distinct trigrams
 * both share over the distinct trigrams either has. 0 when either has no trigram.
 */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * D2 similarity: whether this text is SIMILARITY_THRESHOLD or more similar to any of
 * `comparableTexts` (the Provider's published and held Testimonies).
 */
export function similarityFires(text: string, comparableTexts: readonly string[]): boolean {
  return comparableTexts.some((other) => trigramSimilarity(text, other) >= SIMILARITY_THRESHOLD);
}

/** What detection looks at for one submission. */
export interface DetectionInput {
  otherSubmittedAtMs: readonly number[];
  nowMs: number;
  /** This submission's device and the Provider's earlier signals; D3 is skipped without it. */
  sharedDevice?: { mine: SubmissionSignalHashes; others: readonly OtherSignal[]; authorUid: string };
  /** This submission's text. */
  text: string;
  /** The text of each published or held Testimony for the same Provider. */
  comparableTexts: readonly string[];
}

/** The detection triggers this submission fires, in rule order; empty when it may publish. */
export function detectionRuleCodes(input: DetectionInput): DetectionRuleCode[] {
  const codes: DetectionRuleCode[] = [];
  if (velocityFires(input.otherSubmittedAtMs, input.nowMs)) codes.push("D1");
  if (similarityFires(input.text, input.comparableTexts)) codes.push("D2");
  const device = input.sharedDevice;
  if (device && sharedDeviceFires(device.mine, device.others, device.authorUid)) codes.push("D3");
  return codes;
}
