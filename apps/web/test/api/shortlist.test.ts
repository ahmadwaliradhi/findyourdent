import type { Guidance } from "@findyourdent/contracts";
import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shareToken } from "../../app/server/share.server.ts";
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

const ROOT_CANAL_GUIDANCE = STUB_GUIDANCE_RESPONSE.guidance as unknown as Guidance;

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
      verifiedVisitCount: 0,
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
