import { describe, expect, it } from "vitest";
import {
  type GuidanceCardResponse,
  type GuidanceRequest,
  validateGuidanceRequest,
  validateGuidanceResponse,
} from "../src/index.js";

const guidanceCard: GuidanceCardResponse = {
  kind: "guidance",
  guidance: {
    urgencyTier: "segera",
    likelyCategory: {
      code: "deep_caries_or_pulpitis",
      explanation: "Kemungkinan lubang gigi yang dalam sudah mendekati saraf gigi.",
    },
    journey: {
      type: "multi",
      visits: [
        { order: 1, purpose: "Pemeriksaan dan rontgen" },
        { order: 2, purpose: "Perawatan saluran akar" },
      ],
    },
    likelyProcedures: ["root_canal_treatment", "dental_xray_periapical"],
    whyPricesVary: ["Jumlah saluran akar", "Perlu rontgen atau tidak"],
    costEstimate: [
      {
        procedureCode: "root_canal_treatment",
        minRupiah: 500_000,
        maxRupiah: 3_000_000,
        label: "estimasi",
        source: "Kompilasi tim dari daftar harga publik 2026",
      },
    ],
    bpjs: {
      status: "covered_at_fktp",
      explanation: "Ditanggung di FKTP tempat kamu terdaftar atau dokter gigi mitranya.",
    },
    sources: [{ title: "KMK HK.01.07/MENKES/1492/2023" }],
    disclaimer: "Informasi edukasi, bukan diagnosis.",
  },
};

describe("GuidanceResponse", () => {
  it("accepts a guidance card", () => {
    expect(validateGuidanceResponse(guidanceCard), JSON.stringify(validateGuidanceResponse.errors)).toBe(true);
  });

  it("accepts an emergency response", () => {
    const emergency = {
      kind: "emergency",
      reason: "Bengkak di wajah disertai demam bisa berarti infeksi yang menyebar.",
      redFlags: ["facial_or_neck_swelling", "fever"],
      hospitalSearch: { providerType: "hospital", requiresEmergencyDepartment: true },
    };
    expect(validateGuidanceResponse(emergency)).toBe(true);
  });

  it("accepts a follow-up question with quick replies", () => {
    const followUp = {
      kind: "followUp",
      question: "Apakah sakitnya muncul saat minum dingin?",
      quickReplies: ["Ya", "Tidak"],
    };
    expect(validateGuidanceResponse(followUp)).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(validateGuidanceResponse({ kind: "diagnosis", text: "pulpitis" })).toBe(false);
    expect(validateGuidanceResponse.errors?.length).toBeGreaterThan(0);
  });

  it("rejects extra fields (additionalProperties false)", () => {
    expect(validateGuidanceResponse({ ...guidanceCard, complaintText: "gigi saya sakit" })).toBe(false);
  });

  it("rejects a cost estimate not labelled estimasi", () => {
    const bad = structuredClone(guidanceCard);
    (bad.guidance.costEstimate[0] as { label: string }).label = "harga pasti";
    expect(validateGuidanceResponse(bad)).toBe(false);
  });

  it("rejects an emergency with no red flags", () => {
    const bad = {
      kind: "emergency",
      reason: "x",
      redFlags: [],
      hospitalSearch: { providerType: "hospital", requiresEmergencyDepartment: true },
    };
    expect(validateGuidanceResponse(bad)).toBe(false);
  });

  it("rejects a source url that is not a URI", () => {
    const bad = structuredClone(guidanceCard);
    bad.guidance.sources = [{ title: "x", url: "not a url" }];
    expect(validateGuidanceResponse(bad)).toBe(false);
  });
});

describe("GuidanceRequest", () => {
  it("accepts a typed complaint", () => {
    const req: GuidanceRequest = {
      sessionId: "sess-12345678",
      language: "id",
      complaintText: "Gigi geraham bawah sakit kalau minum dingin",
    };
    expect(validateGuidanceRequest(req)).toBe(true);
  });

  it("requires complaintText or audio", () => {
    expect(validateGuidanceRequest({ sessionId: "sess-12345678", language: "id" })).toBe(false);
  });

  it("accepts a voice note up to about 2 MB and refuses a longer one", () => {
    const voice = (dataBase64: string) => ({
      sessionId: "sess-12345678",
      language: "id",
      audio: { mimeType: "audio/webm", dataBase64 },
    });
    expect(validateGuidanceRequest(voice("A".repeat(2_800_000)))).toBe(true);
    expect(validateGuidanceRequest(voice("A".repeat(2_800_001)))).toBe(false);
  });
});
