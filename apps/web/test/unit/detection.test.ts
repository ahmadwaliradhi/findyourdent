import { describe, expect, it } from "vitest";
import {
  detectionRuleCodes,
  SIMILARITY_THRESHOLD,
  sharedDeviceFires,
  sharedDeviceLinks,
  sharesDevice,
  similarityFires,
  trigramSimilarity,
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

const TEXT = "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih sekali.";
/** TEXT with one word changed: a templated copy. */
const TEMPLATED = "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih sekali!";
const DIFFERENT = "Antreannya lama, tapi perawatnya ramah dan biayanya dijelaskan di awal.";

describe("detectionRuleCodes", () => {
  it("is empty when nothing fires", () => {
    expect(
      detectionRuleCodes({ otherSubmittedAtMs: [ago(HOUR)], nowMs: NOW, text: TEXT, comparableTexts: [] }),
    ).toEqual([]);
  });

  it("names D1 when velocity fires", () => {
    expect(
      detectionRuleCodes({
        otherSubmittedAtMs: [ago(HOUR), ago(2 * HOUR)],
        nowMs: NOW,
        text: TEXT,
        comparableTexts: [],
      }),
    ).toEqual(["D1"]);
  });

  it("names D2 when the text is a templated copy of a comparable one", () => {
    expect(
      detectionRuleCodes({ otherSubmittedAtMs: [], nowMs: NOW, text: TEMPLATED, comparableTexts: [DIFFERENT, TEXT] }),
    ).toEqual(["D2"]);
  });

  it("names D1 then D2 when both fire", () => {
    expect(
      detectionRuleCodes({
        otherSubmittedAtMs: [ago(HOUR), ago(2 * HOUR)],
        nowMs: NOW,
        text: TEXT,
        comparableTexts: [TEXT],
      }),
    ).toEqual(["D1", "D2"]);
  });
});

describe("D2 similarity: character-trigram Jaccard", () => {
  it("is 1 for the same text and 0 for texts sharing no trigram", () => {
    expect(trigramSimilarity("dokternya sabar", "dokternya sabar")).toBe(1);
    expect(trigramSimilarity("abcdef", "uvwxyz")).toBe(0);
  });

  it("is shared trigrams over all distinct trigrams", () => {
    // {abc, bcd} and {abc, bce}: 1 shared of 3.
    expect(trigramSimilarity("abcd", "abce")).toBeCloseTo(1 / 3);
    // {aaa} from "aaaa" and {aaa, aab}: repeated trigrams count once.
    expect(trigramSimilarity("aaaa", "aaab")).toBeCloseTo(1 / 2);
  });

  it("ignores case and runs of whitespace", () => {
    expect(trigramSimilarity("Dokternya  SABAR\n sekali", "dokternya sabar sekali")).toBe(1);
  });

  it("is 0 when either text has no trigram", () => {
    expect(trigramSimilarity("ab", "ab")).toBe(0);
    expect(trigramSimilarity("", "abc")).toBe(0);
  });
});

describe("D2 similarity: the threshold", () => {
  it("is 0.8", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.8);
  });

  it("fires at 0.8 and not just below it", () => {
    // "abcdefghijkl" has 10 trigrams; "abcdefghijklm" adds "klm": 10 of 11 (0.91).
    expect(similarityFires("abcdefghijklm", ["abcdefghijkl"])).toBe(true);
    // 4 shared of 5 distinct: {abc,bcd,cde,def} vs {abc,bcd,cde,def,efg}: exactly 0.8.
    expect(similarityFires("abcdefg", ["abcdef"])).toBe(true);
    // {abc,bcd,cde,def} vs {abc,bcd,cdx}: 2 shared of 5 distinct (0.4).
    expect(similarityFires("abcdef", ["abcdx"])).toBe(false);
  });

  it("does not fire for different text or with nothing to compare", () => {
    expect(similarityFires(TEXT, [DIFFERENT])).toBe(false);
    expect(similarityFires(TEXT, [])).toBe(false);
  });

  it("fires for a templated copy with one word changed", () => {
    expect(similarityFires(TEMPLATED, [TEXT])).toBe(true);
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
    expect(
      detectionRuleCodes({ otherSubmittedAtMs: [], nowMs: NOW, text: TEXT, comparableTexts: [], sharedDevice: shared }),
    ).toEqual(["D3"]);
  });

  it("lists D1 before D3 when both fire", () => {
    const input = {
      otherSubmittedAtMs: [ago(HOUR), ago(2 * HOUR)],
      nowMs: NOW,
      text: TEXT,
      comparableTexts: [],
      sharedDevice: shared,
    };
    expect(detectionRuleCodes(input)).toEqual(["D1", "D3"]);
  });

  it("lists D1, D2 then D3 when all fire", () => {
    const input = {
      otherSubmittedAtMs: [ago(HOUR), ago(2 * HOUR)],
      nowMs: NOW,
      text: TEXT,
      comparableTexts: [TEXT],
      sharedDevice: shared,
    };
    expect(detectionRuleCodes(input)).toEqual(["D1", "D2", "D3"]);
  });
});

describe("sharesDevice", () => {
  const a = { ipHash: "ip-a", browserIdHash: "bid-a" };
  const b = { ipHash: "ip-b", browserIdHash: "bid-b" };

  it("says which hash is shared", () => {
    expect(sharesDevice([a], { ipHash: "ip-a", browserIdHash: "bid-x" })).toEqual({
      sharedIp: true,
      sharedBrowser: false,
    });
    expect(sharesDevice([a], { ipHash: "ip-x", browserIdHash: "bid-a" })).toEqual({
      sharedIp: false,
      sharedBrowser: true,
    });
    expect(sharesDevice([a], { ipHash: "ip-x", browserIdHash: "bid-x" })).toEqual({
      sharedIp: false,
      sharedBrowser: false,
    });
  });

  it("matches any of several signals of mine, and ORs what they share", () => {
    expect(sharesDevice([a, b], { ipHash: "ip-a", browserIdHash: "bid-b" })).toEqual({
      sharedIp: true,
      sharedBrowser: true,
    });
    expect(sharesDevice([], { ipHash: "ip-a", browserIdHash: "bid-a" })).toEqual({
      sharedIp: false,
      sharedBrowser: false,
    });
  });
});

describe("sharedDeviceLinks", () => {
  const mine = [{ ipHash: "ip-1", browserIdHash: "bid-1" }];
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

  it("gives one link per Testimony, OR-ing what its signals share", () => {
    const links = sharedDeviceLinks(
      mine,
      [
        other("t-1", "u-1", "ip-1", "bid-x"),
        other("t-2", "u-2", "ip-x", "bid-1"),
        other("t-1", "u-1", "ip-y", "bid-1"),
      ],
      "u-me",
    );
    expect(links).toEqual([
      { testimonyId: "t-1", authorUid: "u-1", sharedIp: true, sharedBrowser: true },
      { testimonyId: "t-2", authorUid: "u-2", sharedIp: false, sharedBrowser: true },
    ]);
  });

  it("matches against every signal of the held Testimony", () => {
    const edited = [...mine, { ipHash: "ip-2", browserIdHash: "bid-2" }];
    const links = sharedDeviceLinks(edited, [other("t-1", "u-1", "ip-2", "bid-x")], "u-me");
    expect(links).toEqual([{ testimonyId: "t-1", authorUid: "u-1", sharedIp: true, sharedBrowser: false }]);
  });
});
