import type { GuidanceRequest, ShortlistReasonsRequest, ShortlistReasonsResponse } from "@findyourdent/contracts";
import type { AgentAdapter } from "./agent.ts";
import type { AppCheckVerifier } from "./app-check.ts";
import type { GeminiAdapter, GeminiStructuredRequest } from "./gemini.ts";
import type { PlaceSummary, PlacesAdapter, TextSearch, TextSearchResult } from "./places.ts";

/** A stub Guidance card, valid against guidance-response.schema.json. */
export const STUB_GUIDANCE_RESPONSE = {
  kind: "guidance",
  guidance: {
    urgencyTier: "segera",
    likelyCategory: {
      code: "deep_caries_or_pulpitis",
      explanation:
        "Nyeri berdenyut yang memburuk saat malam bisa berarti lubang gigi sudah dalam dan mengenai saraf gigi.",
    },
    journey: {
      type: "multi",
      visits: [
        { order: 1, purpose: "Pemeriksaan, rontgen, dan pembersihan saluran akar awal" },
        { order: 2, purpose: "Pengisian saluran akar" },
        { order: 3, purpose: "Tumpatan akhir atau mahkota gigi" },
      ],
    },
    likelyProcedures: ["root_canal_treatment", "dental_xray_periapical"],
    whyPricesVary: [
      "Jumlah saluran akar berbeda antara gigi depan dan geraham",
      "Perlu atau tidaknya rontgen",
      "Dokter gigi umum atau spesialis konservasi gigi",
    ],
    costEstimate: [
      {
        procedureCode: "root_canal_treatment",
        minRupiah: 800000,
        maxRupiah: 3500000,
        label: "estimasi",
        source: "Data contoh (stub), bukan harga nyata",
      },
    ],
    bpjs: {
      status: "covered_at_fktp",
      explanation:
        "Perawatan dasar ditanggung di FKTP tempat Anda terdaftar atau dokter gigi jejaringnya. FKTP dapat diganti setelah tiga bulan terdaftar, berlaku bulan berikutnya.",
    },
    sources: [{ title: "Stub source", citation: "Placeholder until grounding lands" }],
    disclaimer: "Ini informasi edukasi, bukan diagnosis. Tetap periksakan gigi Anda ke dokter gigi.",
  },
} as const;

/** One stub reason per Provider asked about, valid against shortlist-reasons-response.schema.json. */
export function stubShortlistReasons(request: ShortlistReasonsRequest): ShortlistReasonsResponse {
  const reason = request.language === "en" ? "Stub reason, not written by Gemini" : "Alasan contoh, bukan dari Gemini";
  return { reasons: request.providers.map((p) => ({ placeId: p.placeId, reason })) };
}

export interface FakeAgentAdapter extends AgentAdapter {
  readonly calls: GuidanceRequest[];
  readonly reasonsCalls: ShortlistReasonsRequest[];
  /** Next value returned (or thrown, if an Error) by requestGuidance. */
  respondWith(response: unknown): void;
  /** Next value returned (or thrown, if an Error) by requestShortlistReasons; the default is stub reasons. */
  respondToReasonsWith(response: unknown): void;
}

export function createFakeAgentAdapter(initial: unknown = STUB_GUIDANCE_RESPONSE): FakeAgentAdapter {
  let next: unknown = initial;
  let nextReasons: unknown;
  const calls: GuidanceRequest[] = [];
  const reasonsCalls: ShortlistReasonsRequest[] = [];
  return {
    calls,
    reasonsCalls,
    respondWith(response) {
      next = response;
    },
    respondToReasonsWith(response) {
      nextReasons = response;
    },
    async requestGuidance(request) {
      calls.push(structuredClone(request));
      if (next instanceof Error) throw next;
      return structuredClone(next);
    },
    async requestShortlistReasons(request) {
      reasonsCalls.push(structuredClone(request));
      if (nextReasons instanceof Error) throw nextReasons;
      return nextReasons === undefined ? stubShortlistReasons(request) : structuredClone(nextReasons);
    },
  };
}

export interface FakePlacesAdapter extends PlacesAdapter {
  readonly calls: TextSearch[];
  /** Next answer: places found, or a failed result such as the daily cap being reached. */
  respondWith(answer: PlaceSummary[] | TextSearchResult): void;
}

export function createFakePlacesAdapter(initial: PlaceSummary[] = []): FakePlacesAdapter {
  let next: TextSearchResult = { ok: true, places: initial };
  const calls: TextSearch[] = [];
  return {
    calls,
    respondWith(answer) {
      next = Array.isArray(answer) ? { ok: true, places: answer } : answer;
    },
    async searchText(search) {
      calls.push(structuredClone(search));
      return structuredClone(next);
    },
  };
}

export interface FakeGeminiAdapter extends GeminiAdapter {
  readonly calls: GeminiStructuredRequest[];
  respondWith(output: unknown): void;
}

export function createFakeGeminiAdapter(initial: unknown = {}): FakeGeminiAdapter {
  let next: unknown = initial;
  const calls: GeminiStructuredRequest[] = [];
  return {
    calls,
    respondWith(output) {
      next = output;
    },
    async generateStructured(request) {
      calls.push(structuredClone(request));
      if (next instanceof Error) throw next;
      return structuredClone(next);
    },
  };
}

export interface FakeAppCheckVerifier extends AppCheckVerifier {
  /** A fresh token the fake accepts, standing in for one browser's App Check token. */
  issueToken(): string;
}

/** Accepts only tokens it issued, so a test can tell one browser from another. */
export function createFakeAppCheckVerifier(): FakeAppCheckVerifier {
  const issued = new Set<string>();
  return {
    issueToken() {
      const token = `fake-app-check.${crypto.randomUUID()}`;
      issued.add(token);
      return token;
    },
    async verify(token) {
      return issued.has(token);
    },
  };
}
