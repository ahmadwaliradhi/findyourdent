// Submission signals (spec 09 part 2): what is kept of the device behind a Testimony
// submission or edit, so detection (D3) can see two accounts using one device. Pure.
// Only salted hashes are kept, never the raw IP or browser id.
import { createHash } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A signal expires (Firestore TTL on `submissionSignals.expiresAt`) this long after it is written. */
export const SUBMISSION_SIGNAL_TTL_DAYS = 90;
export const SUBMISSION_SIGNAL_TTL_MS = SUBMISSION_SIGNAL_TTL_DAYS * DAY_MS;

export const signalExpiresAtMs = (nowMs: number) => nowMs + SUBMISSION_SIGNAL_TTL_MS;

/** Firestore TTL deletes lazily, so an expired signal may still be stored: it must not count. */
export const signalIsLive = (expiresAtMs: number, nowMs: number) => expiresAtMs > nowMs;

/** Domain-separated, so an IP and a browser id with the same text never hash alike. */
function hashSignal(salt: string, kind: "ip" | "browser", value: string): string {
  return createHash("sha256").update(`${salt}:signal:${kind}:${value}`).digest("hex");
}

/** The hashes of one submission's device (`SubmissionSignalDoc`). */
export interface SubmissionSignalHashes {
  ipHash: string;
  browserIdHash: string;
}

/** The salted SHA-256 (hex) of the client IP and of the opaque browser id. */
export function submissionSignalHashes(
  salt: string,
  device: { ip: string; browserId: string },
): SubmissionSignalHashes {
  return {
    ipHash: hashSignal(salt, "ip", device.ip),
    browserIdHash: hashSignal(salt, "browser", device.browserId),
  };
}
