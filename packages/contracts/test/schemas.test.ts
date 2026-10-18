import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCHEMAS,
  validateModerationDecision,
  validateModerationRequest,
  validatePriceListExtractionRequest,
  validatePriceListExtractionResponse,
  validateShortlistReasonsRequest,
  validateShortlistReasonsResponse,
} from "../src/index.js";

const schemasDir = join(import.meta.dirname, "..", "schemas");

describe("schemas", () => {
  const files = readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"));

  it("every schema file has a compiled validator", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(files.map((f) => f.replace(".schema.json", "")).sort());
  });

  it.each(files)("%s is draft 2020-12 and closes every object", (file) => {
    const schema = JSON.parse(readFileSync(join(schemasDir, file), "utf8"));
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const open: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => {
          walk(n, `${path}/${i}`);
        });
        return;
      }
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object" && obj.additionalProperties !== false) open.push(path);
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}/${k}`);
    };
    walk(schema, "#");
    expect(open).toEqual([]);
  });
});

describe("Shortlist reasons", () => {
  it("accepts a request and a response", () => {
    expect(
      validateShortlistReasonsRequest({
        sessionId: "sess-12345678",
        language: "id",
        likelyProcedures: ["root_canal_treatment"],
        providers: [
          {
            placeId: "ChIJ-example",
            name: "Klinik Gigi Sehat",
            providerType: "klinik",
            providerTypeSource: "inferred",
            rank: 1,
            distanceMeters: 1200,
            testimonies: { count: 3, verifiedVisitCount: 1, averageHygiene: 4.5 },
            priceSignals: [
              { procedureCode: "root_canal_treatment", minRupiah: 800000, maxRupiah: 1500000, source: "testimonies" },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      validateShortlistReasonsResponse({ reasons: [{ placeId: "ChIJ-example", reason: "Dekat dan bersih." }] }),
    ).toBe(true);
  });

  it("rejects more than five providers", () => {
    const p = {
      placeId: "x",
      name: "x",
      providerType: "klinik",
      providerTypeSource: "inferred",
      rank: 1,
      testimonies: { count: 0, verifiedVisitCount: 0 },
    };
    expect(
      validateShortlistReasonsRequest({
        sessionId: "sess-12345678",
        language: "id",
        likelyProcedures: [],
        providers: [p, p, p, p, p, p],
      }),
    ).toBe(false);
  });
});

describe("Moderation", () => {
  it("accepts a request without ratings and rejects one with ratings", () => {
    const req = { subjectType: "testimony", language: "id", text: "Kliniknya bersih.", visitMonth: "2026-09" };
    expect(validateModerationRequest(req)).toBe(true);
    expect(validateModerationRequest({ ...req, ratings: { service: 5 } })).toBe(false);
  });

  it("accepts an authorFix decision with spans", () => {
    expect(
      validateModerationDecision({
        decision: "authorFix",
        ruleCodes: ["r1_personal_data"],
        flaggedSpans: [{ start: 10, end: 22, text: "081234567890", ruleCode: "r1_personal_data" }],
        confidence: 0.92,
        authorMessage: "Hapus nomor telepon dari ceritamu.",
      }),
    ).toBe(true);
  });

  it("rejects an unknown decision or rule code", () => {
    const base = { ruleCodes: [], flaggedSpans: [], confidence: 1, authorMessage: "ok" };
    expect(validateModerationDecision({ ...base, decision: "delete" })).toBe(false);
    expect(validateModerationDecision({ ...base, decision: "hold", ruleCodes: ["r99"] })).toBe(false);
  });

  describe("Proof of Visit extraction", () => {
    const base = { decision: "publish", ruleCodes: [], flaggedSpans: [], confidence: 0.9, authorMessage: "ok" };
    const facts = {
      readable: true,
      isProofOfVisit: true,
      clinicNameOnProof: "Klinik Gigi Senyum",
      proofDate: "2026-08-14",
      totalRupiah: 350_000,
      clinicNameMatches: true,
    };

    it("accepts the facts with a day or a month, and without the optional ones", () => {
      expect(validateModerationDecision({ ...base, proofExtraction: facts })).toBe(true);
      expect(validateModerationDecision({ ...base, proofExtraction: { ...facts, proofDate: "2026-08" } })).toBe(true);
      const unreadable = { readable: false, isProofOfVisit: false, clinicNameMatches: false };
      expect(validateModerationDecision({ ...base, proofExtraction: unreadable })).toBe(true);
    });

    it("has no place for the patient's name, an accept/reject verdict or a malformed date", () => {
      for (const extra of [{ patientName: "Budi" }, { result: "accepted" }, { proofDate: "14/08/2026" }]) {
        expect(validateModerationDecision({ ...base, proofExtraction: { ...facts, ...extra } })).toBe(false);
      }
      expect(validateModerationDecision({ ...base, proofOfVisit: "accepted" })).toBe(false);
    });
  });
});

describe("Price List extraction", () => {
  const pdf = { mimeType: "application/pdf", dataBase64: "JVBERi0x" };
  const image = { mimeType: "image/jpeg", dataBase64: "/9j/4AAQ" };

  it("accepts one PDF or up to five images, not both or neither", () => {
    expect(validatePriceListExtractionRequest({ pdf })).toBe(true);
    expect(validatePriceListExtractionRequest({ images: [image, image] })).toBe(true);
    expect(validatePriceListExtractionRequest({ pdf, images: [image] })).toBe(false);
    expect(validatePriceListExtractionRequest({})).toBe(false);
    expect(validatePriceListExtractionRequest({ images: Array(6).fill(image) })).toBe(false);
  });

  it("accepts ok rows and a failed result, but not failed with rows", () => {
    expect(
      validatePriceListExtractionResponse({
        kind: "ok",
        rows: [
          {
            procedureCode: "scaling",
            procedureText: "Scaling RA/RB",
            minRupiah: 250000,
            maxRupiah: 250000,
            unit: "per_visit",
            confidence: 0.8,
          },
        ],
      }),
    ).toBe(true);
    expect(
      validatePriceListExtractionResponse({ kind: "failed", retryMessage: "Coba unggah foto yang lebih jelas." }),
    ).toBe(true);
    expect(validatePriceListExtractionResponse({ kind: "failed", retryMessage: "x", rows: [] })).toBe(false);
  });
});
