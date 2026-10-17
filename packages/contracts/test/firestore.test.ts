import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTIONS, dailyQuotaCounterId } from "../src/firestore.js";

describe("Firestore model", () => {
  it("has the ten collections from spec 00, each documented in docs/data-model.md", () => {
    expect(Object.values(COLLECTIONS).sort()).toEqual(
      [
        "adminActions",
        "claims",
        "counters",
        "moderationDecisions",
        "nameCorrections",
        "priceLists",
        "providers",
        "rateLimits",
        "testimonies",
        "testimonyReports",
      ].sort(),
    );
    const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "data-model.md"), "utf8");
    for (const name of Object.values(COLLECTIONS)) expect(doc, name).toContain(`### \`${name}\``);
  });

  it("builds daily quota counter ids", () => {
    expect(dailyQuotaCounterId("places", "shortlistSearch", "2026-10-20")).toBe(
      "quota.places.shortlistSearch.2026-10-20",
    );
  });
});
