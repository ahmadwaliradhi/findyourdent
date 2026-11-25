import { describe, expect, it } from "vitest";
import {
  detectionRuleCodes,
  sharedDeviceFires,
  sharedDeviceLinks,
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

describe("D3 sharedDevice", () => {
  const mine = { ipHash: "ip-a", browserIdHash: "bid-a" };
  const other = (overrides: Partial<{ authorUid: string; ipHash: string; browserIdHash: string }> = {}) => ({
    authorUid: "uid-other",
    ipHash: "ip-b",
    browserIdHash: "bid-b",
    ...overrides,
  });

  it("does not fire with no other signals", () => {
    expect(sharedDeviceFires(mine, [], "uid-me")).toBe(false);
  });

  it("does not fire when another account shares neither hash", () => {
    expect(sharedDeviceFires(mine, [other()], "uid-me")).toBe(false);
  });

  it("fires when another account shares the IP hash", () => {
    expect(sharedDeviceFires(mine, [other({ ipHash: "ip-a" })], "uid-me")).toBe(true);
  });

  it("fires when another account shares the browser-id hash", () => {
    expect(sharedDeviceFires(mine, [other({ browserIdHash: "bid-a" })], "uid-me")).toBe(true);
  });

  it("never counts the account's own signals", () => {
    const own = other({ authorUid: "uid-me", ipHash: "ip-a", browserIdHash: "bid-a" });
    expect(sharedDeviceFires(mine, [own], "uid-me")).toBe(false);
  });

  it("fires on any one of several signals", () => {
    const signals = [other(), other({ authorUid: "uid-me", ipHash: "ip-a" }), other({ browserIdHash: "bid-a" })];
    expect(sharedDeviceFires(mine, signals, "uid-me")).toBe(true);
  });
});

describe("detectionRuleCodes with D3", () => {
  const shared = {
    mine: { ipHash: "ip-a", browserIdHash: "bid-a" },
    others: [{ authorUid: "uid-other", ipHash: "ip-a", browserIdHash: "bid-b" }],
    authorUid: "uid-me",
  };

  it("names D3 when a device is shared", () => {
    expect(detectionRuleCodes({ otherSubmittedAtMs: [], nowMs: NOW, sharedDevice: shared })).toEqual(["D3"]);
  });

  it("lists D1 before D3 when both fire", () => {
    const input = {
      otherSubmittedAtMs: [ago(HOUR), ago(2 * HOUR)],
      nowMs: NOW,
      sharedDevice: shared,
    };
    expect(detectionRuleCodes(input)).toEqual(["D1", "D3"]);
  });
});

describe("sharedDeviceLinks", () => {
  const mine = { ipHash: "ip-1", browserIdHash: "bid-1" };
  const other = (testimonyId: string, authorUid: string, ipHash: string, browserIdHash: string) => ({
    testimonyId,
    authorUid,
    ipHash,
    browserIdHash,
  });

  it("names which hash another account shares", () => {
    const links = sharedDeviceLinks(
      mine,
      [
        other("t-ip", "u-1", "ip-1", "bid-x"),
        other("t-bid", "u-2", "ip-x", "bid-1"),
        other("t-both", "u-3", "ip-1", "bid-1"),
      ],
      "u-me",
    );
    expect(links).toEqual([
      { testimonyId: "t-ip", authorUid: "u-1", sharedIp: true, sharedBrowser: false },
      { testimonyId: "t-bid", authorUid: "u-2", sharedIp: false, sharedBrowser: true },
      { testimonyId: "t-both", authorUid: "u-3", sharedIp: true, sharedBrowser: true },
    ]);
  });

  it("skips the author's own signals and signals that share nothing", () => {
    expect(
      sharedDeviceLinks(
        mine,
        [other("t-own", "u-me", "ip-1", "bid-1"), other("t-none", "u-1", "ip-x", "bid-x")],
        "u-me",
      ),
    ).toEqual([]);
  });
});
