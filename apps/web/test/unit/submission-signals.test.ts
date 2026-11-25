import { describe, expect, it } from "vitest";
import {
  SUBMISSION_SIGNAL_TTL_MS,
  signalExpiresAtMs,
  signalIsLive,
  submissionSignalHashes,
} from "../../app/server/submission-signals.ts";

const SALT = "test-salt";
const HEX_SHA256 = /^[0-9a-f]{64}$/;

describe("submissionSignalHashes", () => {
  it("returns lowercase SHA-256 hex for the IP and the browser id", () => {
    const hashes = submissionSignalHashes(SALT, { ip: "203.0.113.7", browserId: "bid-1" });
    expect(hashes.ipHash).toMatch(HEX_SHA256);
    expect(hashes.browserIdHash).toMatch(HEX_SHA256);
  });

  it("is stable for the same input and salt", () => {
    const input = { ip: "203.0.113.7", browserId: "bid-1" };
    expect(submissionSignalHashes(SALT, input)).toEqual(submissionSignalHashes(SALT, input));
  });

  it("never contains the raw IP or browser id", () => {
    const hashes = submissionSignalHashes(SALT, { ip: "203.0.113.7", browserId: "bid-secret-1" });
    const json = JSON.stringify(hashes);
    expect(json).not.toContain("203.0.113.7");
    expect(json).not.toContain("bid-secret-1");
  });

  it("changes with the salt", () => {
    const input = { ip: "203.0.113.7", browserId: "bid-1" };
    expect(submissionSignalHashes("other-salt", input)).not.toEqual(submissionSignalHashes(SALT, input));
  });

  it("keeps the IP and browser id domains apart: the same string hashes differently", () => {
    const { ipHash, browserIdHash } = submissionSignalHashes(SALT, {
      ip: "same",
      browserId: "same",
    });
    expect(ipHash).not.toBe(browserIdHash);
  });

  it("differs per IP and per browser id", () => {
    const a = submissionSignalHashes(SALT, { ip: "203.0.113.7", browserId: "bid-1" });
    const b = submissionSignalHashes(SALT, { ip: "203.0.113.8", browserId: "bid-2" });
    expect(a.ipHash).not.toBe(b.ipHash);
    expect(a.browserIdHash).not.toBe(b.browserIdHash);
  });
});

describe("signal expiry", () => {
  it("is 90 days after the submission", () => {
    expect(SUBMISSION_SIGNAL_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
    const now = Date.UTC(2026, 10, 25);
    expect(signalExpiresAtMs(now)).toBe(Date.UTC(2027, 1, 23));
  });
});

describe("signalIsLive", () => {
  it("is live until its expiry and not at or after it", () => {
    expect(signalIsLive(1001, 1000)).toBe(true);
    expect(signalIsLive(1000, 1000)).toBe(false);
    expect(signalIsLive(999, 1000)).toBe(false);
  });
});
