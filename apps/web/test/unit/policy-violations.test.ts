import type { PolicyViolationStatus } from "@findyourdent/contracts/firestore";
import { describe, expect, it } from "vitest";
import {
  badgeUntilMs,
  nextViolationStatus,
  VIOLATION_BADGE_MONTHS,
  VIOLATION_MOVES,
  VIOLATION_RESPONSE_DAYS,
  type ViolationMove,
  visibleBadgeUntil,
} from "../../app/lib/policy-violations.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-10T00:00:00Z");
const STATUSES: PolicyViolationStatus[] = ["open", "providerNotified", "confirmed", "dismissed"];

// Spec 09 part 2: open -> providerNotified -> confirmed | dismissed; dismiss also from open.
const ALLOWED: ReadonlyArray<[ViolationMove, PolicyViolationStatus, PolicyViolationStatus]> = [
  ["notifyViolation", "open", "providerNotified"],
  ["dismissViolation", "open", "dismissed"],
  ["dismissViolation", "providerNotified", "dismissed"],
  ["confirmViolation", "providerNotified", "confirmed"],
];

describe("violation moves", () => {
  it("gives the Provider seven days", () => {
    expect(VIOLATION_RESPONSE_DAYS).toBe(7);
  });

  it.each(ALLOWED)("%s moves %s to %s (confirm after the window)", (move, from, to) => {
    expect(nextViolationStatus(move, from, { nowMs: NOW, responseDueMs: NOW - DAY_MS })).toBe(to);
  });

  it("allows nothing else, from any status", () => {
    for (const move of VIOLATION_MOVES) {
      for (const from of STATUSES) {
        if (ALLOWED.some(([m, f]) => m === move && f === from)) continue;
        expect(nextViolationStatus(move, from, { nowMs: NOW, responseDueMs: NOW - DAY_MS })).toBeNull();
      }
    }
  });

  it("refuses to confirm before the response window is over, and accepts it at the instant", () => {
    expect(
      nextViolationStatus("confirmViolation", "providerNotified", { nowMs: NOW, responseDueMs: NOW + 1 }),
    ).toBeNull();
    expect(nextViolationStatus("confirmViolation", "providerNotified", { nowMs: NOW, responseDueMs: NOW })).toBe(
      "confirmed",
    );
    expect(nextViolationStatus("confirmViolation", "providerNotified", { nowMs: NOW })).toBeNull();
  });
});

describe("violation badge length", () => {
  it("lasts 6 calendar months from the decision", () => {
    expect(VIOLATION_BADGE_MONTHS).toBe(6);
    expect(badgeUntilMs(Date.parse("2026-11-10T08:30:00Z"))).toBe(Date.parse("2027-05-10T08:30:00Z"));
    expect(badgeUntilMs(Date.parse("2026-08-31T00:00:00Z"))).toBe(Date.parse("2027-02-28T00:00:00Z"));
    expect(badgeUntilMs(Date.parse("2023-08-31T12:00:00Z"))).toBe(Date.parse("2024-02-29T12:00:00Z"));
    expect(badgeUntilMs(Date.parse("2026-12-15T00:00:00Z"))).toBe(Date.parse("2027-06-15T00:00:00Z"));
  });

  it("gives the badge end as an ISO instant only while now is before badgeUntil", () => {
    const until = Date.parse("2027-05-10T00:00:00Z");
    const badge = { badgeUntil: { toMillis: () => until, toDate: () => new Date(until) } };
    expect(visibleBadgeUntil(badge, until - 1)).toBe("2027-05-10T00:00:00.000Z");
    expect(visibleBadgeUntil(badge, until)).toBeNull();
    expect(visibleBadgeUntil(undefined, until)).toBeNull();
  });
});
