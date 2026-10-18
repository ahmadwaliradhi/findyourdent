// The Proof Fingerprint's two pure parts (spec 09): the key built from the facts read,
// and the perceptual hash, which must call a re-photographed receipt the same and two
// different receipts different. The reuse check itself is tested through the web API.
import type { ProofExtraction } from "@findyourdent/contracts";
import { describe, expect, it } from "vitest";
import { fieldsKey, hammingDistance, perceptualHash } from "../../app/server/proof-fingerprint.server.ts";
import { nearCopy, receiptJpeg } from "../support/receipts.ts";

const facts = (overrides: Partial<ProofExtraction>): ProofExtraction => ({
  readable: true,
  isProofOfVisit: true,
  clinicNameMatches: true,
  ...overrides,
});

describe("Proof Fingerprint key", () => {
  it("normalises the clinic name and keeps the date and total as read", () => {
    expect(
      fieldsKey(
        facts({ clinicNameOnProof: "  KLINIK Gigi Céria, Cab. Depok ", proofDate: "2026-10-01", totalRupiah: 300_000 }),
      ),
    ).toBe("klinik gigi ceria cab depok|2026-10-01|300000");
  });

  it("matches on a printed day without a total, or a month with a total", () => {
    expect(fieldsKey(facts({ clinicNameOnProof: "drg. Ani", proofDate: "2026-10-01" }))).toBe("drg ani|2026-10-01|");
    expect(fieldsKey(facts({ clinicNameOnProof: "drg. Ani", proofDate: "2026-10", totalRupiah: 0 }))).toBe(
      "drg ani|2026-10|0",
    );
    expect(fieldsKey(facts({ proofDate: "2026-10-01", totalRupiah: 150_000 }))).toBe("|2026-10-01|150000");
  });

  it("has no key when it cannot tell two visits apart: no date, or a month without a total", () => {
    expect(fieldsKey(facts({ clinicNameOnProof: "Klinik Gigi Ceria", totalRupiah: 300_000 }))).toBeUndefined();
    expect(fieldsKey(facts({ clinicNameOnProof: "Klinik Gigi Ceria", proofDate: "2026-10" }))).toBeUndefined();
    expect(fieldsKey(facts({}))).toBeUndefined();
  });
});

describe("Proof Fingerprint perceptual hash", () => {
  const labels = ["Klinik Gigi Ceria", "Klinik Gigi Ceria, struk dua", "drg. Ani", "RS Gigi Sehat", "Klinik Sentosa"];

  it("is 64 bits as 16 hex digits", async () => {
    expect(await perceptualHash(await receiptJpeg("Klinik Gigi Ceria"))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("stays within 10 bits for the same receipt cropped, brightened and saved again", async () => {
    for (const label of labels) {
      const original = await receiptJpeg(label);
      const distance = hammingDistance(await perceptualHash(original), await perceptualHash(await nearCopy(original)));
      expect(distance, label).toBeLessThanOrEqual(10);
    }
  });

  it("tells receipts with different line items apart", async () => {
    const hashes = await Promise.all(labels.map(async (label) => perceptualHash(await receiptJpeg(label))));
    for (const [i, a] of hashes.entries()) {
      for (const [j, b] of hashes.entries()) {
        if (j > i) expect(hammingDistance(a, b), `${labels[i]} / ${labels[j]}`).toBeGreaterThan(10);
      }
    }
  });
});
