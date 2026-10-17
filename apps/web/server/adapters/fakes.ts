import type { GuidanceRequest, ShortlistReasonsRequest, ShortlistReasonsResponse } from "@findyourdent/contracts";
import type { AgentAdapter } from "./agent.ts";
import type { AppCheckVerifier } from "./app-check.ts";
import type { GeminiAdapter, GeminiStructuredRequest } from "./gemini.ts";
import type {
  AutocompleteRequest,
  AutocompleteResult,
  AutocompleteSuggestion,
  CoordinatesResult,
  GoogleBlock,
  GoogleBlockResult,
  GoogleReview,
  GoogleReviewsResult,
  PlaceDetailsRequest,
  PlaceSummary,
  PlacesAdapter,
  TextSearch,
  TextSearchResult,
} from "./places.ts";

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
  /** Text Searches, in order. */
  readonly calls: TextSearch[];
  /** Place Details calls, in order, named by the adapter method that made them. */
  readonly detailsCalls: (PlaceDetailsRequest & { method: "getGoogleBlock" | "getGoogleReviews" })[];
  /** Next answer: places found, or a failed result such as the daily cap being reached. */
  respondWith(answer: PlaceSummary[] | TextSearchResult): void;
  /** Next Google block: the facts for any place id asked, or a failed result. */
  respondWithGoogleBlock(answer: Omit<GoogleBlock, "placeId"> | GoogleBlockResult): void;
  /** Next Google Reviews: the reviews, or a failed result. */
  respondWithReviews(answer: GoogleReview[] | GoogleReviewsResult): void;
  /** Autocomplete requests, in order. */
  readonly autocompleteCalls: AutocompleteRequest[];
  /** Next Autocomplete answer: suggestions, or a failed result. */
  respondWithSuggestions(answer: AutocompleteSuggestion[] | AutocompleteResult): void;
  /** Place ids asked for coordinates, in order. */
  readonly coordinatesCalls: string[];
  /** Next coordinates answer. Defaults to a point in Jakarta. */
  respondWithCoordinates(answer: CoordinatesResult): void;
}

export function createFakePlacesAdapter(initial: PlaceSummary[] = []): FakePlacesAdapter {
  let next: TextSearchResult = { ok: true, places: initial };
  let nextBlock: Omit<GoogleBlock, "placeId"> | GoogleBlockResult = { displayName: "Fake Google Place", types: [] };
  let nextReviews: GoogleReviewsResult = { ok: true, reviews: [] };
  let nextSuggestions: AutocompleteResult = { ok: true, suggestions: [] };
  let nextCoordinates: CoordinatesResult = { ok: true, location: { lat: -6.1754, lng: 106.8272 } };
  const calls: TextSearch[] = [];
  const detailsCalls: FakePlacesAdapter["detailsCalls"] = [];
  const autocompleteCalls: AutocompleteRequest[] = [];
  const coordinatesCalls: string[] = [];
  return {
    calls,
    detailsCalls,
    autocompleteCalls,
    coordinatesCalls,
    respondWithSuggestions(answer) {
      nextSuggestions = Array.isArray(answer) ? { ok: true, suggestions: answer } : answer;
    },
    respondWithCoordinates(answer) {
      nextCoordinates = answer;
    },
    async autocomplete(request) {
      autocompleteCalls.push(structuredClone(request));
      return structuredClone(nextSuggestions);
    },
    async getCoordinates(placeId) {
      coordinatesCalls.push(placeId);
      return structuredClone(nextCoordinates);
    },
    respondWith(answer) {
      next = Array.isArray(answer) ? { ok: true, places: answer } : answer;
    },
    respondWithGoogleBlock(answer) {
      nextBlock = answer;
    },
    respondWithReviews(answer) {
      nextReviews = Array.isArray(answer) ? { ok: true, reviews: answer } : answer;
    },
    async searchText(search) {
      calls.push(structuredClone(search));
      return structuredClone(next);
    },
    async getGoogleBlock(request) {
      detailsCalls.push({ method: "getGoogleBlock", ...request });
      if ("ok" in nextBlock) return structuredClone(nextBlock);
      return { ok: true, block: { placeId: request.placeId, ...structuredClone(nextBlock) } };
    },
    async getGoogleReviews(request) {
      detailsCalls.push({ method: "getGoogleReviews", ...request });
      return structuredClone(nextReviews);
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

/** Sample places for local runs and the browser tests (PLACES_ADAPTER=fake). Made up, not Google data. */
const SAMPLE_PLACES: PlaceSummary[] = [
  {
    placeId: "sample-klinik-senyum",
    displayName: "Klinik Gigi Senyum Contoh",
    formattedAddress: "Jl. Contoh No. 1, Surabaya",
    location: { lat: -7.2711, lng: 112.7509 },
    types: ["dentist", "health"],
    googleMapsUri: "https://www.google.com/maps/search/?api=1&query=Klinik&query_place_id=sample-klinik-senyum",
  },
  {
    placeId: "sample-drg-ani",
    displayName: "drg. Ani Contoh",
    formattedAddress: "Jl. Contoh No. 2, Surabaya",
    location: { lat: -7.2856, lng: 112.7509 },
    types: ["dentist", "health"],
    googleMapsUri: "https://www.google.com/maps/search/?api=1&query=drg&query_place_id=sample-drg-ani",
  },
];

const SAMPLE_REVIEWS: GoogleReview[] = [
  {
    rating: 5,
    text: "Contoh ulasan: dokternya sabar dan ruangannya bersih.",
    relativeTime: "2 minggu lalu",
    author: { name: "Pengulas Contoh", uri: "https://www.google.com/maps/contrib/sample", photoUri: "/favicon.svg" },
  },
];

/**
 * The fake adapter with SAMPLE_PLACES: every search finds them, each has a Google
 * block and one review. Any other place id answers like a used-up daily cap, so the
 * fallback can be seen too.
 */
export function createFakeSamplePlacesAdapter(): PlacesAdapter {
  const known = new Map(SAMPLE_PLACES.map((place) => [place.placeId, place]));
  return {
    async searchText() {
      return { ok: true, places: structuredClone(SAMPLE_PLACES) };
    },
    async getGoogleBlock({ placeId }) {
      const place = known.get(placeId);
      if (!place) return { ok: false, reason: "cap_reached" };
      return {
        ok: true,
        block: {
          placeId,
          displayName: place.displayName,
          types: place.types,
          ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
          openNow: true,
          weekdayHours: ["Senin: 09.00–21.00", "Selasa: 09.00–21.00"],
          nationalPhoneNumber: "0812-0000-0001",
          rating: 4.6,
          userRatingCount: 12,
          ...(place.googleMapsUri ? { googleMapsUri: place.googleMapsUri } : {}),
        },
      };
    },
    async getGoogleReviews({ placeId }) {
      return known.has(placeId)
        ? { ok: true, reviews: structuredClone(SAMPLE_REVIEWS) }
        : { ok: false, reason: "cap_reached" };
    },
    async autocomplete({ input }) {
      const query = input.trim().toLowerCase();
      const suggestions = SAMPLE_PLACES.filter((place) => place.displayName.toLowerCase().includes(query)).map(
        (place) => ({
          placeId: place.placeId,
          mainText: place.displayName,
          ...(place.formattedAddress ? { secondaryText: place.formattedAddress } : {}),
        }),
      );
      return { ok: true, suggestions };
    },
    async getCoordinates(placeId) {
      const location = known.get(placeId)?.location;
      return location ? { ok: true, location } : { ok: false, reason: "not_found" };
    },
  };
}
