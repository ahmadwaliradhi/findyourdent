import type { PolicyViolationStatus } from "@findyourdent/contracts/firestore";
import { describe, expect, it } from "vitest";
import {
  nextViolationStatus,
  VIOLATION_MOVES,
  VIOLATION_RESPONSE_DAYS,
  type ViolationMove,
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
