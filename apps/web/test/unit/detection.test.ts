import { describe, expect, it } from "vitest";
import {
  detectionRuleCodes,
  VELOCITY_DAY_THRESHOLD,
  VELOCITY_DAY_WINDOW_MS,
  VELOCITY_WEEK_THRESHOLD,
  VELOCITY_WEEK_WINDOW_MS,
  velocityFires,
} from "../../app/server/detection.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const ago = (ms: number) => NOW - ms;

describe("D1 velocity", () => {
  it("is 3 within 24 hours and 5 within 7 days, counting this submission", () => {
    expect(VELOCITY_DAY_THRESHOLD).toBe(3);
    expect(VELOCITY_DAY_WINDOW_MS).toBe(24 * HOUR);
    expect(VELOCITY_WEEK_THRESHOLD).toBe(5);
    expect(VELOCITY_WEEK_WINDOW_MS).toBe(7 * 24 * HOUR);
  });

  it("does not fire with no other Testimonies", () => {
    expect(velocityFires([], NOW)).toBe(false);
  });

  it("does not fire on the 2nd within 24 hours, and fires on the 3rd", () => {
    expect(velocityFires([ago(HOUR)], NOW)).toBe(false);
    expect(velocityFires([ago(HOUR), ago(2 * HOUR)], NOW)).toBe(true);
  });

  it("counts a Testimony just inside 24 hours but not one at or past it", () => {
    expect(velocityFires([ago(HOUR), ago(24 * HOUR - 1)], NOW)).toBe(true);
    expect(velocityFires([ago(HOUR), ago(24 * HOUR)], NOW)).toBe(false);
    expect(velocityFires([ago(HOUR), ago(25 * HOUR)], NOW)).toBe(false);
  });

  it("does not fire on the 4th within 7 days, and fires on the 5th", () => {
    const days = (n: number) => ago(n * 24 * HOUR);
    expect(velocityFires([days(2), days(3), days(4)], NOW)).toBe(false);
    expect(velocityFires([days(2), days(3), days(4), days(5)], NOW)).toBe(true);
  });

  it("counts a Testimony just inside 7 days but not one at or past it", () => {
    const days = (n: number) => ago(n * 24 * HOUR);
    expect(velocityFires([days(2), days(3), days(4), ago(VELOCITY_WEEK_WINDOW_MS - 1)], NOW)).toBe(true);
    expect(velocityFires([days(2), days(3), days(4), ago(VELOCITY_WEEK_WINDOW_MS)], NOW)).toBe(false);
    expect(velocityFires([days(2), days(3), days(4), days(8), days(30)], NOW)).toBe(false);
  });

  it("counts a time slightly after now (clock skew) as inside both windows", () => {
    expect(velocityFires([NOW + 1000, ago(HOUR)], NOW)).toBe(true);
  });
});

describe("detectionRuleCodes", () => {
  it("is empty when nothing fires", () => {
    expect(detectionRuleCodes({ otherSubmittedAtMs: [ago(HOUR)], nowMs: NOW })).toEqual([]);
  });

  it("names D1 when velocity fires", () => {
    expect(detectionRuleCodes({ otherSubmittedAtMs: [ago(HOUR), ago(2 * HOUR)], nowMs: NOW })).toEqual(["D1"]);
  });
});
