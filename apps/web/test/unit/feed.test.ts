import { describe, expect, it } from "vitest";
import { decodeFeedCursor, encodeFeedCursor, excerpt } from "../../app/server/feed.server.ts";

describe("feed cursor", () => {
  it("round-trips the publish time, to the microsecond Firestore keeps, and the Testimony id", () => {
    const position = { seconds: 1_792_000_000, nanoseconds: 123_456_000, id: "AbC123xyz" };
    const cursor = encodeFeedCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFeedCursor(cursor)).toEqual(position);
  });

  it("rejects anything it did not make", () => {
    const encoded = (raw: string) => Buffer.from(raw).toString("base64url");
    for (const bad of [
      "",
      "not a cursor",
      "Zm9v",
      "a".repeat(400),
      encoded("12:0:"),
      encoded("-5:0:abc"),
      encoded("12:1000000000:abc"),
      encoded("12:0:a/b"),
      encoded("1.5:0:abc"),
    ]) {
      expect(decodeFeedCursor(bad), bad).toBeNull();
    }
  });
});

describe("excerpt", () => {
  it("keeps short text whole, with whitespace collapsed", () => {
    expect(excerpt("Dokternya  sabar.\n\nBiaya jelas.")).toBe("Dokternya sabar. Biaya jelas.");
  });

  it("cuts long text on a word boundary and marks the cut", () => {
    const text = `${"kata ".repeat(70)}akhir`;
    const result = excerpt(text, 40);
    expect(result).toBe("kata kata kata kata kata kata kata kata…");
    expect(result.length).toBeLessThanOrEqual(41);
  });

  it("cuts a single overlong word at the limit", () => {
    expect(excerpt("a".repeat(50), 10)).toBe(`${"a".repeat(10)}…`);
  });
});
