import type { Guidance } from "@findyourdent/contracts";
import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shareToken } from "../../app/server/share.server.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
import type { PlaceSummary } from "../../server/adapters/places.ts";
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
          verifiedVisitCount: 3,
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
      testimonies: { count: 6, verifiedVisitCount: 3 },
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
        aggregates: { testimonyCount: 2, verifiedVisitCount: 2, averages: null, procedurePrices: paid },
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
      verifiedVisitCount: 3,
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
          verifiedVisitCount: 3,
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
        verifiedVisitCount: 3,
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
    expect(body.providers[0]?.reason).toBe("Nilai Testimoni 4,6 dari 3 Testimoni terbukti");
    for (const provider of body.providers) expect(provider.reason).not.toMatch(/^Gemini/);
  });

  it("falls back to the templated reasons when the agent's answer breaks the contract", async () => {
    await seedRankedThree();
    server.fakes.agent.respondToReasonsWith({ reasons: [{ placeId: GOOGLE_CLINIC.placeId, reason: "" }] });

    const { body } = await shortlist(request());

    expect(body.providers[0]?.reason).toBe("Nilai Testimoni 4,6 dari 3 Testimoni terbukti");
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

    expect(english.body.providers[0]?.reason).toBe("Testimony score 4.6 from 3 verified Testimonies");
    expect(indonesian.body.providers[0]?.reason).toBe("Nilai Testimoni 4,6 dari 3 Testimoni terbukti");
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
