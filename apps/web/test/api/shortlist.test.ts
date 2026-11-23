import type { Guidance, ModerationDecision, ProofOfVisitExtraction } from "@findyourdent/contracts";
import { type AspectRatings, COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonyStoredResponse, TestimonySubmission } from "../../app/lib/testimony.ts";
import { shareToken } from "../../app/server/share.server.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
import type { PlaceSummary } from "../../server/adapters/places.ts";
import { submittedBeforeDetectionWindow } from "../support/fixtures.ts";
import { startTestServer, type TestServer } from "../support/harness.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  await server.reset();
});

/** Gubeng, Surabaya: where the Patient shares their location from. */
const GUBENG = { lat: -7.2756, lng: 112.7509 };

// Without the stub's language, as on Guidance links made before it existed; tests that need one set it.
const { language: _stubLanguage, ...ROOT_CANAL_GUIDANCE } = STUB_GUIDANCE_RESPONSE.guidance as unknown as Guidance;

const WISDOM_TOOTH_GUIDANCE: Guidance = {
  ...ROOT_CANAL_GUIDANCE,
  likelyCategory: { code: "wisdom_tooth_or_pericoronitis", explanation: "Gigi bungsu yang tumbuh miring." },
  likelyProcedures: ["wisdom_tooth_surgery", "dental_xray_panoramic"],
  costEstimate: [
    {
      procedureCode: "wisdom_tooth_surgery",
      minRupiah: 2_000_000,
      maxRupiah: 6_000_000,
      label: "estimasi",
      source: "Uji",
    },
  ],
};

function tokenFor(guidance: Guidance): string {
  return shareToken(guidance, "test-share-link-secret");
}

/** Live Google facts the fake Places adapter returns; none of these may reach Firestore. */
const GOOGLE_CLINIC: PlaceSummary = {
  placeId: "place-klinik-senyum",
  displayName: "Klinik Gigi Senyum Google Name",
  formattedAddress: "Jl. Google Address 1, Surabaya",
  location: { lat: -7.2711, lng: 112.7509 },
  types: ["dentist", "health", "google_only_type_marker"],
  googleMapsUri: "https://maps.google.com/?cid=google-clinic",
};
const GOOGLE_DRG: PlaceSummary = {
  placeId: "place-drg-ani",
  displayName: "drg. Ani Wijaya",
  formattedAddress: "Jl. Google Address 2, Surabaya",
  location: { lat: -7.2856, lng: 112.7509 },
  types: ["dentist", "health"],
  googleMapsUri: "https://maps.google.com/?cid=google-drg",
};
const GOOGLE_HOSPITAL: PlaceSummary = {
  placeId: "place-rs-dr-soetomo",
  displayName: "RSUD Google Hospital",
  formattedAddress: "Jl. Google Address 3, Surabaya",
  location: { lat: -7.2666, lng: 112.7509 },
  types: ["hospital", "health"],
  googleMapsUri: "https://maps.google.com/?cid=google-hospital",
};

const NOW = Timestamp.fromDate(new Date("2026-10-15T03:00:00Z"));

/** A Listed Provider as Testimonies and Claims leave it: first-party facts plus place_id and dated coordinates. */
function listedProvider(placeId: string, overrides: Partial<ProviderDoc> = {}): ProviderDoc {
  return {
    placeId,
    name: `Listed ${placeId}`,
    nameSource: "testimonyAuthor",
    nameNormalized: `listed ${placeId}`,
    region: { provinceCode: "35", regencyCode: "35.78" },
    location: { lat: GUBENG.lat + 0.02, lng: GUBENG.lng, fetchedAt: NOW },
    providerType: "klinik",
    providerTypeSource: "inferred",
    claimStatus: "unclaimed",
    aggregates: { testimonyCount: 0, verifiedVisitCount: 0, averages: null, procedurePrices: {} },
    listedBy: "testimony",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function seedProviders(...providers: ProviderDoc[]) {
  const batch = server.firestore.batch();
  for (const provider of providers) {
    // Firestore rejects undefined; a Provider whose coordinates expired has no location field at all.
    const data = Object.fromEntries(Object.entries(provider).filter(([, value]) => value !== undefined));
    batch.set(server.firestore.collection(COLLECTIONS.providers).doc(provider.placeId), data);
  }
  await batch.commit();
}

interface ShortlistBody {
  source: "places" | "listedProviders";
  mapsSearchUrl?: string;
  providers: {
    placeId: string;
    name: string;
    providerType: string;
    providerTypeSource: "inferred" | "claimed";
    listed: boolean;
    claimed: boolean;
    distanceMeters: number | null;
    reason: string;
    googleMapsUri: string;
    testimonies: { count: number; verifiedVisitCount: number };
    priceSignals: { procedureCode: string; source: string; minRupiah: number; maxRupiah: number; asOf?: string }[];
  }[];
}

async function shortlist(body: unknown, init?: Parameters<TestServer["post"]>[2]) {
  const response = await server.post("/api/shortlist", body, init);
  return { response, body: (await response.json()) as ShortlistBody & { error?: string } };
}

/** Every document in every collection, as Firestore holds it after the requests. */
async function everyStoredDocument(): Promise<string> {
  const dump: unknown[] = [];
  for (const collection of await server.firestore.listCollections()) {
    for (const doc of (await collection.get()).docs) dump.push({ path: doc.ref.path, data: doc.data() });
  }
  return JSON.stringify(dump);
}

describe("POST /api/shortlist", () => {
  it("refuses a request without App Check and never calls Places", async () => {
    const { response } = await shortlist(
      { purpose: "shortlist", guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE), location: GUBENG },
      { appCheckToken: null },
    );

    expect(response.status).toBe(401);
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("makes one dentist Text Search biased to about 5 km around a shared location", async () => {
    server.fakes.places.respondWith([GOOGLE_CLINIC]);

    const { response } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      location: GUBENG,
    });

    expect(response.status).toBe(200);
    expect(server.fakes.places.calls).toEqual([
      {
        purpose: "shortlist",
        textQuery: "dokter gigi",
        includedType: "dentist",
        locationBias: { center: GUBENG, radiusMeters: 5000 },
        language: "id",
      },
    ]);
  });

  it("puts a typed area in the query text instead of a location bias", async () => {
    const { body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      area: "Gubeng, Surabaya",
    });

    expect(server.fakes.places.calls[0]).toMatchObject({ textQuery: "dokter gigi di Gubeng, Surabaya" });
    expect(server.fakes.places.calls[0]?.locationBias).toBeUndefined();
    expect(body.source).toBe("places");
  });

  it("searches Hospitals when the likely procedures are surgical referrals", async () => {
    await shortlist({ purpose: "shortlist", guidanceToken: tokenFor(WISDOM_TOOTH_GUIDANCE), location: GUBENG });

    expect(server.fakes.places.calls[0]).toMatchObject({ includedType: "hospital" });
  });

  it("searches Hospitals when any likely procedure is a surgical referral", async () => {
    const mixed: Guidance = {
      ...WISDOM_TOOTH_GUIDANCE,
      likelyProcedures: ["tooth_extraction", "wisdom_tooth_surgery"],
    };

    await shortlist({ purpose: "shortlist", guidanceToken: tokenFor(mixed), location: GUBENG });

    expect(server.fakes.places.calls[0]).toMatchObject({ includedType: "hospital" });
  });

  it("lists up to five Providers with distance, type marked as estimated, Testimonies, prices and a reason", async () => {
    server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_DRG, GOOGLE_HOSPITAL]);
    await seedProviders(
      listedProvider(GOOGLE_CLINIC.placeId, {
        name: "Klinik Senyum Gubeng",
        aggregates: {
          testimonyCount: 6,
          verifiedVisitCount: 2,
          averages: { service: 4.6, hygiene: 4.8, materialsEquipment: 4.5 },
          procedurePrices: {
            root_canal_treatment: { count: 3, medianRupiah: 1_200_000, minRupiah: 900_000, maxRupiah: 1_500_000 },
          },
        },
      }),
    );

    const { body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      location: GUBENG,
    });

    expect(body.providers.map((p) => p.placeId)).toEqual([
      GOOGLE_CLINIC.placeId,
      GOOGLE_HOSPITAL.placeId,
      GOOGLE_DRG.placeId,
    ]);
    const [clinic, hospital, drg] = body.providers;
    // The Listed Provider's own name, never Google's, once FindYourDent has one.
    expect(clinic).toMatchObject({
      name: "Klinik Senyum Gubeng",
      listed: true,
      claimed: false,
      providerType: "klinik",
      providerTypeSource: "inferred",
      testimonies: { count: 6, verifiedVisitCount: 2 },
      googleMapsUri: GOOGLE_CLINIC.googleMapsUri,
    });
    expect(clinic?.distanceMeters).toBeGreaterThan(400);
    expect(clinic?.distanceMeters).toBeLessThan(600);
    expect(clinic?.priceSignals).toEqual([
      {
        procedureCode: "root_canal_treatment",
        source: "testimonies",
        minRupiah: 1_200_000,
        maxRupiah: 1_200_000,
        asOf: "2026-10-15",
      },
      { procedureCode: "root_canal_treatment", source: "costEstimate", minRupiah: 800_000, maxRupiah: 3_500_000 },
    ]);
    expect(clinic?.reason).not.toBe("");
    // Not listed: Google's live name and an inferred type from the rule in spec 02.
    expect(hospital).toMatchObject({ name: "RSUD Google Hospital", providerType: "hospital", listed: false });
    expect(drg).toMatchObject({
      name: "drg. Ani Wijaya",
      providerType: "privateDentist",
      providerTypeSource: "inferred",
    });
  });

  it("shows the owner's confirmed Price List second, after prices paid, with its date and an outdated note", async () => {
    server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_DRG]);
    const paid = {
      root_canal_treatment: { count: 2, medianRupiah: 1_200_000, minRupiah: 1_000_000, maxRupiah: 1_400_000 },
    };
    await seedProviders(
      listedProvider(GOOGLE_CLINIC.placeId, {
        claimStatus: "claimed",
        claimId: "claim-current",
        aggregates: { testimonyCount: 2, verifiedVisitCount: 0, averages: null, procedurePrices: paid },
      }),
      listedProvider(GOOGLE_DRG.placeId, { claimStatus: "claimed", claimId: "claim-current-drg" }),
    );
    const list = (placeId: string, claimId: string, confirmedAt: Date) => ({
      placeId,
      claimId,
      uploadedBy: "owner-uid",
      source: "ownerPriceList",
      status: "current",
      rows: [
        {
          procedureCode: "root_canal_treatment",
          procedureText: "PSA",
          minRupiah: 1_500_000,
          maxRupiah: 2_500_000,
          unit: "per_tooth",
        },
      ],
      uploadedAt: confirmedAt,
      confirmedAt,
    });
    const lists = server.firestore.collection(COLLECTIONS.priceLists);
    await lists.add(list(GOOGLE_CLINIC.placeId, "claim-current", new Date("2025-06-01T03:00:00Z")));
    // A list from an earlier claimant of the same place is never shown.
    await lists.add(list(GOOGLE_DRG.placeId, "claim-revoked", new Date()));

    const { body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      location: GUBENG,
    });

    const clinic = body.providers.find((p) => p.placeId === GOOGLE_CLINIC.placeId);
    expect(clinic?.priceSignals.map((s) => s.source)).toEqual(["testimonies", "priceList", "costEstimate"]);
    expect(clinic?.priceSignals[1]).toEqual({
      procedureCode: "root_canal_treatment",
      source: "priceList",
      minRupiah: 1_500_000,
      maxRupiah: 2_500_000,
      asOf: "2025-06-01",
      possiblyOutdated: true,
    });
    const drg = body.providers.find((p) => p.placeId === GOOGLE_DRG.placeId);
    expect(drg?.priceSignals.map((s) => s.source)).toEqual(["costEstimate"]);
  });

  it("writes no Google field to Firestore other than place_id and dated coordinates", async () => {
    server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_DRG, GOOGLE_HOSPITAL]);
    await seedProviders(listedProvider(GOOGLE_CLINIC.placeId));

    await shortlist({ purpose: "shortlist", guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE), location: GUBENG });
    await shortlist({ purpose: "emergency", location: GUBENG });

    const stored = await everyStoredDocument();
    for (const place of [GOOGLE_CLINIC, GOOGLE_DRG, GOOGLE_HOSPITAL]) {
      expect(stored).not.toContain(place.displayName);
      expect(stored).not.toContain(place.formattedAddress);
      expect(stored).not.toContain(place.googleMapsUri);
    }
    expect(stored).not.toContain("google_only_type_marker");
  });

  it("does not let a Claim lift a Provider above a better unclaimed one", async () => {
    server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_DRG]);
    const ratings = (average: number) => ({
      testimonyCount: 5,
      verifiedVisitCount: 5,
      averages: { service: average, hygiene: average, materialsEquipment: average },
      procedurePrices: {},
    });
    await seedProviders(
      listedProvider(GOOGLE_CLINIC.placeId, { claimStatus: "claimed", claimId: "claim-1", aggregates: ratings(3.6) }),
      listedProvider(GOOGLE_DRG.placeId, { providerType: "privateDentist", aggregates: ratings(4.7) }),
    );

    const { body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      location: GUBENG,
    });

    expect(body.providers.map((p) => [p.placeId, p.claimed])).toEqual([
      [GOOGLE_DRG.placeId, false],
      [GOOGLE_CLINIC.placeId, true],
    ]);
  });

  it("ranks a claimed Provider exactly as the same Provider unclaimed", async () => {
    const ratings = {
      testimonyCount: 4,
      verifiedVisitCount: 4,
      averages: { service: 4.2, hygiene: 4.4, materialsEquipment: 4 },
      procedurePrices: {},
    };
    const run = async (claimed: boolean) => {
      await server.reset();
      server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_DRG]);
      await seedProviders(
        listedProvider(GOOGLE_CLINIC.placeId, {
          aggregates: ratings,
          ...(claimed ? { claimStatus: "claimed", claimId: "claim-1", nameSource: "claim" } : {}),
        }),
        listedProvider(GOOGLE_DRG.placeId, { providerType: "privateDentist", aggregates: ratings }),
      );
      const { body } = await shortlist({
        purpose: "shortlist",
        guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
        location: GUBENG,
      });
      return body.providers.map(({ claimed: _claimed, ...rest }) => rest);
    };

    const unclaimed = await run(false);
    expect(unclaimed).toHaveLength(2);
    expect(await run(true)).toEqual(unclaimed);
  });

  it("finds nearby Hospitals for the emergency card without needing a Guidance", async () => {
    server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_HOSPITAL]);

    const { response, body } = await shortlist({ purpose: "emergency", location: GUBENG });

    expect(response.status).toBe(200);
    expect(server.fakes.places.calls[0]).toMatchObject({ purpose: "emergency", includedType: "hospital" });
    expect(body.providers.map((p) => p.placeId)).toEqual([GOOGLE_HOSPITAL.placeId]);
  });

  it("falls back to Listed Providers within about 10 km plus a Google Maps search link when the cap is reached", async () => {
    server.fakes.places.respondWith({ ok: false, reason: "cap_reached" });
    await seedProviders(
      listedProvider("listed-near", { location: { lat: GUBENG.lat + 0.03, lng: GUBENG.lng, fetchedAt: NOW } }),
      listedProvider("listed-far", { location: { lat: GUBENG.lat + 0.25, lng: GUBENG.lng, fetchedAt: NOW } }),
      listedProvider("listed-no-coordinates", { location: undefined }),
    );

    const { response, body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      location: GUBENG,
    });

    expect(response.status).toBe(200);
    expect(body.source).toBe("listedProviders");
    expect(body.providers.map((p) => p.placeId)).toEqual(["listed-near"]);
    expect(body.mapsSearchUrl).toBe("https://www.google.com/maps/search/?api=1&query=dokter%20gigi%20terdekat");
  });

  it("falls back for a typed area to Listed Providers in the named kota or kabupaten", async () => {
    server.fakes.places.respondWith({ ok: false, reason: "cap_reached" });
    await seedProviders(
      listedProvider("listed-surabaya"),
      listedProvider("listed-malang", { region: { provinceCode: "35", regencyCode: "35.73" } }),
    );

    const { body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      area: "Gubeng, Surabaya",
    });

    expect(body.providers.map((p) => p.placeId)).toEqual(["listed-surabaya"]);
    expect(body.mapsSearchUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=dokter%20gigi%20di%20Gubeng%2C%20Surabaya",
    );
  });

  it("refuses a Shortlist whose Guidance link was altered, before calling Places", async () => {
    const [payload] = tokenFor(ROOT_CANAL_GUIDANCE).split(".");

    const { response, body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: `${payload}.forged-signature`,
      location: GUBENG,
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_request");
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("refuses a location outside Indonesia", async () => {
    const { response } = await shortlist({
      purpose: "emergency",
      location: { lat: 51.5, lng: -0.12 },
    });

    expect(response.status).toBe(400);
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("never logs the Patient's location or typed area", async () => {
    await shortlist({ purpose: "shortlist", guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE), area: "Gubeng, Surabaya" });
    await shortlist({ purpose: "emergency", location: GUBENG });

    const logs = server.logs.join("\n");
    expect(logs).not.toContain("Gubeng");
    expect(logs).not.toContain(String(GUBENG.lat));
  });
});

describe("POST /api/shortlist reasons (T09)", () => {
  /** The clinic leads on Testimonies, then the Hospital, then the private dentist (see the ranking test above). */
  async function seedRankedThree() {
    server.fakes.places.respondWith([GOOGLE_CLINIC, GOOGLE_DRG, GOOGLE_HOSPITAL]);
    await seedProviders(
      listedProvider(GOOGLE_CLINIC.placeId, {
        name: "Klinik Senyum Gubeng",
        aggregates: {
          testimonyCount: 6,
          verifiedVisitCount: 4,
          averages: { service: 4.6, hygiene: 4.8, materialsEquipment: 4.5 },
          procedurePrices: {
            root_canal_treatment: { count: 3, medianRupiah: 1_200_000, minRupiah: 900_000, maxRupiah: 1_500_000 },
          },
        },
      }),
    );
  }
  const RANKED = [GOOGLE_CLINIC.placeId, GOOGLE_HOSPITAL.placeId, GOOGLE_DRG.placeId];
  const GEMINI: Record<string, string> = {
    [GOOGLE_CLINIC.placeId]: "Gemini: kebersihan dinilai tinggi oleh enam pasien.",
    [GOOGLE_HOSPITAL.placeId]: "Gemini: rumah sakit dengan poli gigi.",
    [GOOGLE_DRG.placeId]: "Gemini: praktik dokter gigi pribadi di dekat Anda.",
  };
  const reasonsFor = (placeIds: string[]) => ({
    reasons: placeIds.map((placeId) => ({ placeId, reason: GEMINI[placeId] ?? `Gemini: ${placeId}` })),
  });
  const request = () => ({ purpose: "shortlist", guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE), location: GUBENG });

  it("shows Gemini's reason on each card, asked with the ranked top Providers and their facts", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith(reasonsFor(RANKED));

    const { body } = await shortlist(request());

    expect(body.providers.map((p) => [p.placeId, p.reason])).toEqual(RANKED.map((id) => [id, GEMINI[id]]));
    expect(server.fakes.agent.reasonsCalls).toHaveLength(1);
    const sent = server.fakes.agent.reasonsCalls[0];
    expect(sent).toMatchObject({
      language: "id",
      likelyCategoryCode: "deep_caries_or_pulpitis",
      likelyProcedures: ["root_canal_treatment", "dental_xray_periapical"],
    });
    expect(sent?.sessionId.length).toBeGreaterThanOrEqual(8);
    expect(sent?.providers.map((p) => [p.rank, p.placeId])).toEqual(RANKED.map((id, i) => [i + 1, id]));
    expect(sent?.providers[0]).toMatchObject({
      name: "Klinik Senyum Gubeng",
      providerType: "klinik",
      providerTypeSource: "inferred",
      procedureFit: expect.arrayContaining(["root_canal_treatment"]),
      testimonies: {
        count: 6,
        verifiedVisitCount: 4,
        averageService: 4.6,
        averageHygiene: 4.8,
        averageMaterialsEquipment: 4.5,
      },
      priceSignals: [
        { procedureCode: "root_canal_treatment", source: "testimonies", minRupiah: 1_200_000, maxRupiah: 1_200_000 },
        { procedureCode: "root_canal_treatment", source: "costEstimate", minRupiah: 800_000, maxRupiah: 3_500_000 },
      ],
    });
    expect(sent?.providers[0]?.distanceMeters).toBeGreaterThan(400);
  });

  it("falls back to the templated reasons when the agent fails", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith(new AgentUnavailableError("agent responded 503", 503));

    const { response, body } = await shortlist(request());

    expect(response.status).toBe(200);
    expect(body.providers.map((p) => p.placeId)).toEqual(RANKED);
    expect(body.providers[0]?.reason).toBe("Nilai Testimoni 4,6 dari 4 Testimoni terbukti");
    for (const provider of body.providers) expect(provider.reason).not.toMatch(/^Gemini/);
  });

  it("falls back to the templated reasons when the agent's answer breaks the contract", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith({ reasons: [{ placeId: GOOGLE_CLINIC.placeId, reason: "" }] });

    const { body } = await shortlist(request());

    expect(body.providers[0]?.reason).toBe("Nilai Testimoni 4,6 dari 4 Testimoni terbukti");
  });

  it("never lets the agent reorder, add or drop a Provider", async () => {
    await seedRankedThree();
    // Reversed, the Hospital missing, and one Provider the ranking never chose.
    server.fakes.agent.respondToReasonsWith(
      reasonsFor([GOOGLE_DRG.placeId, "place-not-in-the-shortlist", GOOGLE_CLINIC.placeId]),
    );

    const { body } = await shortlist(request());

    expect(body.providers.map((p) => p.placeId)).toEqual(RANKED);
    expect(body.providers[0]?.reason).toBe(GEMINI[GOOGLE_CLINIC.placeId]);
    expect(body.providers[1]?.reason).not.toMatch(/^Gemini/);
    expect(body.providers[1]?.reason).not.toBe("");
    expect(body.providers[2]?.reason).toBe(GEMINI[GOOGLE_DRG.placeId]);
  });

  it("does not hold the emergency Hospital list for Gemini", async () => {
    server.fakes.places.respondWith([GOOGLE_HOSPITAL]);

    const { body } = await shortlist({ purpose: "emergency", location: GUBENG });

    expect(server.fakes.agent.reasonsCalls).toEqual([]);
    expect(body.providers[0]?.reason).toMatch(/^Rumah sakit dengan IGD/);
  });

  it("does not call the agent when there is no Provider to explain", async () => {
    server.fakes.places.respondWith([]);

    await shortlist(request());

    expect(server.fakes.agent.reasonsCalls).toEqual([]);
  });

  it("logs only where the reasons came from, never a Provider name or a reason", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith(reasonsFor(RANKED));

    await shortlist(request());

    const logs = server.logs.join("\n");
    expect(logs).toContain('"reasons":"gemini"');
    expect(logs).not.toContain("Klinik Senyum Gubeng");
    expect(logs).not.toContain("Gemini:");
  });

  /** The `cookie` header a browser sends after the Patient picks a language on the toggle. */
  async function toggleCookie(lang: "id" | "en"): Promise<string> {
    const response = await fetch(new URL("/language", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ lang, redirectTo: "/" }),
      redirect: "manual",
    });
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  }
  const ENGLISH_GUIDANCE: Guidance = { ...ROOT_CANAL_GUIDANCE, language: "en" };

  it("writes reasons in the language of the complaint, not the toggle", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith(reasonsFor(RANKED));

    await shortlist(
      { purpose: "shortlist", guidanceToken: tokenFor(ENGLISH_GUIDANCE), location: GUBENG },
      { headers: { cookie: await toggleCookie("id") } },
    );

    expect(server.fakes.agent.reasonsCalls[0]).toMatchObject({ language: "en" });
  });

  it("falls back to templated reasons in the language of the complaint", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith(new AgentUnavailableError("agent responded 503", 503));

    const english = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ENGLISH_GUIDANCE),
      location: GUBENG,
    });
    const indonesian = await shortlist(
      { purpose: "shortlist", guidanceToken: tokenFor({ ...ROOT_CANAL_GUIDANCE, language: "id" }), location: GUBENG },
      { headers: { cookie: await toggleCookie("en") } },
    );

    expect(english.body.providers[0]?.reason).toBe("Testimony score 4.6 from 4 verified Testimonies");
    expect(indonesian.body.providers[0]?.reason).toBe("Nilai Testimoni 4,6 dari 4 Testimoni terbukti");
  });

  it("follows the toggle when the Guidance does not say which language the complaint was in", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith(reasonsFor(RANKED));

    await shortlist(request(), { headers: { cookie: await toggleCookie("en") } });

    expect(server.fakes.agent.reasonsCalls[0]).toMatchObject({ language: "en" });
  });

  it("keeps the emergency Hospital list in the toggle language", async () => {
    server.fakes.places.respondWith([GOOGLE_HOSPITAL]);

    const { body } = await shortlist(
      { purpose: "emergency", location: GUBENG },
      { headers: { cookie: await toggleCookie("en") } },
    );

    expect(body.providers[0]?.reason).toMatch(/^Hospital with an emergency department/);
  });
});

describe("POST /api/shortlist ranks on Proven Testimonies only (spec 09)", () => {
  /**
   * Kliniks for a root canal: equal fit and no price signal, so Testimonies and distance decide.
   * Score = 0.6 * Testimonies + 0.2 * price (0.5, no signal) + 0.2 * distance, with Testimonies
   * (shrunk - 1) / 4 and shrunk = (3 * prior + n * average) / (3 + n).
   */
  const NEAR: PlaceSummary = {
    placeId: "place-klinik-dekat",
    displayName: "Klinik Gigi Dekat Google Name",
    formattedAddress: "Jl. Google Address 4, Surabaya",
    location: GUBENG,
    types: ["dentist", "health"],
    googleMapsUri: "https://maps.google.com/?cid=google-near",
  };
  /** 9452 m south of the Patient: distance score 0.055, against the near Klinik's 1. */
  const FAR: PlaceSummary = {
    placeId: "place-klinik-jauh",
    displayName: "Klinik Gigi Jauh Google Name",
    formattedAddress: "Jl. Google Address 5, Surabaya",
    location: { lat: GUBENG.lat - 0.085, lng: GUBENG.lng },
    types: ["dentist", "health"],
    googleMapsUri: "https://maps.google.com/?cid=google-far",
  };
  /**
   * About 22 km away (past the distance horizon) with 50 Proven 2-star Testimonies: it holds the
   * overall mean the others shrink toward near 2, so the far Klinik's own count, not a drifting
   * mean, decides each step. It ranks last throughout.
   */
  const ANCHOR_LOCATION = { lat: GUBENG.lat + 0.2, lng: GUBENG.lng };
  const ANCHOR: PlaceSummary = {
    placeId: "place-klinik-ramai",
    displayName: "Klinik Gigi Ramai Google Name",
    formattedAddress: "Jl. Google Address 6, Surabaya",
    location: ANCHOR_LOCATION,
    types: ["dentist", "health"],
    googleMapsUri: "https://maps.google.com/?cid=google-busy",
  };
  const TYPED_NAME: Record<string, string> = {
    [NEAR.placeId]: "Klinik Gigi Dekat",
    [FAR.placeId]: "Klinik Gigi Jauh",
  };
  const PUBLISH: ModerationDecision = {
    decision: "publish",
    ruleCodes: [],
    flaggedSpans: [],
    confidence: 0.95,
    authorMessage: "Terima kasih!",
  };
  /** What the agent reads off a matching receipt from the visit month. */
  let patients = 0;

  /**
   * What the agent reads off a matching receipt from the visit month. Each Patient paid a
   * different total: the same clinic, date and total twice would be held as possible reuse.
   */
  const receipt = (placeId: string): ProofOfVisitExtraction => ({
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: TYPED_NAME[placeId] ?? placeId,
    proofDate: "2026-09-12",
    totalRupiah: 300_000 + patients * 1_000,
    clinicNameMatches: true,
  });

  /** One new Patient posts a Testimony through the API, with an accepted Proof of Visit or none. */
  async function postTestimony(placeId: string, score: number, proven: boolean): Promise<void> {
    patients += 1;
    const cookie = await server.signInWithGoogle(`pasien.${patients}@example.com`);
    server.fakes.agent.respondToModerationWith(proven ? { ...PUBLISH, proofOfVisit: receipt(placeId) } : PUBLISH);
    const ratings: AspectRatings = { service: score, hygiene: score, materialsEquipment: score };
    const submission: TestimonySubmission = {
      placeId,
      providerName: TYPED_NAME[placeId],
      region: { provinceCode: "35", regencyCode: "35.78" },
      ratings,
      text: `Pengalaman pasien ${patients}: dokternya menjelaskan perawatan dan biayanya dengan jelas.`,
      visitMonth: "2026-09",
      displayName: `Pasien ${patients}`,
      consent: { honestExperience: true, noOthersPersonalData: true },
    };
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission));
    if (proven) {
      // Each Patient's own receipt: one file twice at a place would be held as possible reuse.
      const bytes = Buffer.from(`%PDF-1.4\n% pasien ${patients}\n%%EOF\n`);
      form.set("proof", new File([new Uint8Array(bytes)], "struk.pdf", { type: "application/pdf" }));
    }
    const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
      method: "POST",
      headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
      body: form,
    });
    if (response.status !== 201) throw new Error(`testimony failed: ${response.status} ${await response.text()}`);
    const stored = (await response.json()) as TestimonyStoredResponse;
    expect(stored).toMatchObject({ status: "published", verifiedVisit: proven });
    await submittedBeforeDetectionWindow(server.firestore, stored.testimonyId);
  }

  const postMany = async (placeId: string, score: number, proven: boolean, times: number) => {
    for (let i = 0; i < times; i += 1) await postTestimony(placeId, score, proven);
  };

  async function shortlistOrder(): Promise<string[]> {
    server.fakes.places.respondWith([FAR, ANCHOR, NEAR]);
    const { response, body } = await shortlist({
      purpose: "shortlist",
      guidanceToken: tokenFor(ROOT_CANAL_GUIDANCE),
      location: GUBENG,
    });
    expect(response.status).toBe(200);
    return body.providers.map((p) => p.placeId);
  }

  it("never reorders on unproven Testimonies, and reorders on Proven ones", async () => {
    await seedProviders(
      listedProvider(ANCHOR.placeId, {
        location: { ...ANCHOR_LOCATION, fetchedAt: NOW },
        aggregates: {
          testimonyCount: 50,
          verifiedVisitCount: 50,
          averages: { service: 2, hygiene: 2, materialsEquipment: 2 },
          procedurePrices: {},
        },
      }),
    );

    // Three Proven Testimonies each: the near Klinik averages 3, the far one 5.
    // Prior (3*3 + 3*5 + 50*2) / 56 = 2.214. Near: shrunk 2.607, 0.6*0.402 + 0.1 + 0.2 = 0.541.
    // Far: shrunk 3.607, 0.6*0.652 + 0.1 + 0.011 = 0.502. Near leads by 0.039.
    await postMany(NEAR.placeId, 3, true, 3);
    await postMany(FAR.placeId, 5, true, 3);
    const before = await shortlistOrder();
    expect(before).toEqual([NEAR.placeId, FAR.placeId, ANCHOR.placeId]);

    // Four unproven 5-star Testimonies for the far Klinik move no input of the new rule: near still
    // leads by 0.039. The old rule (prior and shrinkage weighted by every published Testimony, plus
    // 0.02 per Proven visit, here 0.06 each) would have put the far one first by 0.039:
    // prior (3*3 + 7*5 + 50*2) / 60 = 2.400; near shrunk 2.700, 0.6*(0.425 + 0.06) + 0.3 = 0.591;
    // far shrunk (3*2.4 + 7*5) / 10 = 4.220, 0.6*(0.805 + 0.06) + 0.111 = 0.630.
    await postMany(FAR.placeId, 5, false, 4);
    expect(await shortlistOrder()).toEqual(before);

    // Four more Proven 5-star Testimonies do put it first: 7 Proven, prior 2.400 as above,
    // near 0.6*0.425 + 0.3 = 0.555, far 0.6*0.805 + 0.111 = 0.594. Far leads by 0.039.
    await postMany(FAR.placeId, 5, true, 4);
    expect(await shortlistOrder()).toEqual([FAR.placeId, NEAR.placeId, ANCHOR.placeId]);
  });
});
