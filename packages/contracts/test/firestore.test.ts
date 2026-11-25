import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLLECTIONS,
  dailyQuotaCounterId,
  type PaymentMethod,
  type PaymentMethodCounts,
  type PaymentMethodKind,
  type ProviderAggregates,
  type TestimonyContent,
} from "../src/firestore.js";

describe("Firestore model", () => {
  it("has the collections from specs 00 and 09, each documented in docs/data-model.md", () => {
    expect(Object.values(COLLECTIONS).sort()).toEqual(
      [
        "adminActions",
        "claims",
        "counters",
        "moderationDecisions",
        "nameCorrections",
        "priceLists",
        "proofFingerprints",
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

  it("models a Payment Method as a fact about one visit, optional on a Testimony and its aggregates", () => {
    const methods: PaymentMethod[] = [
      { method: "pribadi" },
      { method: "bpjs" },
      { method: "asuransi", insurer: "prudential" },
      { method: "tidakDisebut" },
    ];
    const kinds: PaymentMethodKind[] = methods.map((m) => m.method);
    expect(kinds).toEqual(["pribadi", "bpjs", "asuransi", "tidakDisebut"]);

    // Type-level: both fields are optional, so Testimonies and aggregates from before spec 07 stay valid.
    type Optional<T, K extends keyof T> = Partial<Pick<T, K>> extends Pick<T, K> ? true : false;
    const testimonyOptional: Optional<TestimonyContent, "paymentMethod"> = true;
    const aggregatesOptional: Optional<ProviderAggregates, "paymentMethodCounts"> = true;
    const counts: PaymentMethodCounts = { pribadi: 1, bpjs: 2, asuransi: 3, insurers: { prudential: 2, allianz: 1 } };
    expect([testimonyOptional, aggregatesOptional, counts.insurers.prudential]).toEqual([true, true, 2]);
  });
});
