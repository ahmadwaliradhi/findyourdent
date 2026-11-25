import { describe, expect, it } from "vitest";
import {
  detectionRuleCodes,
  SIMILARITY_THRESHOLD,
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
