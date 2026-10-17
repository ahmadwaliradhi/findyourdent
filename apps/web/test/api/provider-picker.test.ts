import { COLLECTIONS, type NameCorrectionDoc, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AutocompleteResponse, ProviderListingResponse } from "../../app/lib/testimony.ts";
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

const NOW = Timestamp.fromDate(new Date("2026-10-15T03:00:00Z"));
const LISTED_ID = "ChIJ-listed-senyum";
const UNLISTED_ID = "ChIJ-google-only";
const TOKEN = "3f1c9a52-7d4e-4b8a-9c11-0a2b3c4d5e6f";

/** Google's words for the suggestion; they may be shown, never stored. */
const GOOGLE_MAIN_TEXT = "Klinik Gigi Nama Dari Google";
const GOOGLE_SECONDARY_TEXT = "Jl. Alamat Dari Google 7, Surabaya";

function listedProvider(overrides: Partial<ProviderDoc> = {}): ProviderDoc {
  return {
    placeId: LISTED_ID,
    name: "Klinik Senyum Gubeng",
    nameSource: "testimonyAuthor",
    nameNormalized: "klinik senyum gubeng",
    region: { provinceCode: "35", regencyCode: "35.78" },
    providerType: "klinik",
    providerTypeSource: "inferred",
    claimStatus: "unclaimed",
    aggregates: {
      testimonyCount: 1,
      verifiedVisitCount: 0,
      averages: { service: 4, hygiene: 4, materialsEquipment: 4 },
      procedurePrices: {},
    },
    listedBy: "testimony",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function seedListed(provider = listedProvider()) {
  await server.firestore.collection(COLLECTIONS.providers).doc(provider.placeId).set(provider);
}

async function everyStoredDocument(): Promise<string> {
  const dump: unknown[] = [];
  for (const collection of await server.firestore.listCollections()) {
    for (const doc of (await collection.get()).docs) dump.push({ path: doc.ref.path, data: doc.data() });
  }
  return JSON.stringify(dump);
}

function autocomplete(params: Record<string, string>, init?: Parameters<TestServer["get"]>[1]) {
  return server.get(`/api/places/autocomplete?${new URLSearchParams(params)}`, init);
}

describe("GET /api/places/autocomplete", () => {
  it("passes the input and session token to Autocomplete and returns Google's suggestions", async () => {
    server.fakes.places.respondWithSuggestions([
      { placeId: UNLISTED_ID, mainText: GOOGLE_MAIN_TEXT, secondaryText: GOOGLE_SECONDARY_TEXT },
    ]);

    const response = await autocomplete({ input: "klinik gigi", sessionToken: TOKEN });
    const body = (await response.json()) as AutocompleteResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      suggestions: [{ placeId: UNLISTED_ID, mainText: GOOGLE_MAIN_TEXT, secondaryText: GOOGLE_SECONDARY_TEXT }],
    });
    expect(server.fakes.places.autocompleteCalls).toEqual([
      { input: "klinik gigi", sessionToken: TOKEN, language: "id" },
    ]);
  });

  it("biases by location only when the Patient shared it", async () => {
    await autocomplete({ input: "klinik gigi", sessionToken: TOKEN, lat: "-7.2756", lng: "112.7509" });
    await autocomplete({ input: "klinik gigi", sessionToken: TOKEN });

    const [shared, notShared] = server.fakes.places.autocompleteCalls;
    expect(shared?.locationBias?.center).toEqual({ lat: -7.2756, lng: 112.7509 });
    expect(shared?.locationBias?.radiusMeters).toBeGreaterThan(0);
    expect(notShared).not.toHaveProperty("locationBias");
  });

  it("refuses fewer than 3 characters without calling Places", async () => {
    const response = await autocomplete({ input: "  kl  ", sessionToken: TOKEN });

    expect(response.status).toBe(400);
    expect(server.fakes.places.autocompleteCalls).toEqual([]);
  });

  it("refuses a missing or malformed session token, or half a location, without calling Places", async () => {
    const responses = await Promise.all([
      autocomplete({ input: "klinik gigi" }),
      autocomplete({ input: "klinik gigi", sessionToken: "bad token!" }),
      autocomplete({ input: "klinik gigi", sessionToken: TOKEN, lat: "-7.2" }),
      autocomplete({ input: "klinik gigi", sessionToken: TOKEN, lat: "-97", lng: "112" }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(server.fakes.places.autocompleteCalls).toEqual([]);
  });

  it("refuses a request without App Check and never calls Places", async () => {
    const response = await autocomplete({ input: "klinik gigi", sessionToken: TOKEN }, { appCheckToken: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "app_check_required" });
    expect(server.fakes.places.autocompleteCalls).toEqual([]);
  });

  it("applies the Places rate limit", async () => {
    server.setLimits({ placesPerHour: 2 });

    await autocomplete({ input: "klinik gigi", sessionToken: TOKEN });
    await autocomplete({ input: "klinik gigi s", sessionToken: TOKEN });
    const third = await autocomplete({ input: "klinik gigi se", sessionToken: TOKEN });

    expect(third.status).toBe(429);
    expect(server.fakes.places.autocompleteCalls).toHaveLength(2);
  });

  it("says unavailable, with no suggestions, when the daily cap is reached or Places fails", async () => {
    server.fakes.places.respondWithSuggestions({ ok: false, reason: "cap_reached" });
    const capped = await autocomplete({ input: "klinik gigi", sessionToken: TOKEN });
    server.fakes.places.respondWithSuggestions({ ok: false, reason: "unavailable" });
    const down = await autocomplete({ input: "klinik gigi", sessionToken: TOKEN });

    expect(capped.status).toBe(200);
    expect(await capped.json()).toEqual({ suggestions: [], unavailable: true });
    expect(await down.json()).toEqual({ suggestions: [], unavailable: true });
  });

  it("never stores or logs Google's name or the typed input", async () => {
    server.fakes.places.respondWithSuggestions([
      { placeId: UNLISTED_ID, mainText: GOOGLE_MAIN_TEXT, secondaryText: GOOGLE_SECONDARY_TEXT },
    ]);

    await autocomplete({ input: "rahasia ketikan pasien", sessionToken: TOKEN });

    const stored = await everyStoredDocument();
    expect(stored).not.toContain(GOOGLE_MAIN_TEXT);
    expect(stored).not.toContain(GOOGLE_SECONDARY_TEXT);
    const logs = server.logs.join("\n");
    expect(logs).not.toContain("rahasia ketikan pasien");
    expect(logs).not.toContain(GOOGLE_MAIN_TEXT);
  });
});

describe("GET /api/providers/:placeId/listing", () => {
  it("returns a Listed Provider's stored name and Region, without asking Google", async () => {
    await seedListed();

    const response = await server.get(`/api/providers/${LISTED_ID}/listing`, { appCheckToken: null });
    const body = (await response.json()) as ProviderListingResponse;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      listed: true,
      name: "Klinik Senyum Gubeng",
      region: { provinceCode: "35", regencyCode: "35.78" },
    });
    expect(server.fakes.places.detailsCalls).toEqual([]);
    expect(server.fakes.places.coordinatesCalls).toEqual([]);
  });

  it("says not listed for a place with no Provider document", async () => {
    const response = await server.get(`/api/providers/${UNLISTED_ID}/listing`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ listed: false });
  });

  it("answers 404 for a malformed place id", async () => {
    const response = await server.get("/api/providers/not%20a%20place%3Cid%3E/listing");

    expect(response.status).toBe(404);
  });
});

describe("POST /api/providers/:placeId/name-corrections", () => {
  const path = (placeId: string) => `/api/providers/${placeId}/name-corrections`;

  async function corrections(): Promise<NameCorrectionDoc[]> {
    const snapshot = await server.firestore.collection(COLLECTIONS.nameCorrections).get();
    return snapshot.docs.map((doc) => doc.data() as NameCorrectionDoc);
  }

  it("asks a signed-out Patient to sign in and stores nothing", async () => {
    await seedListed();

    const response = await server.post(path(LISTED_ID), { suggestedName: "Klinik Senyum Baru" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "sign_in_required" });
    expect(await corrections()).toEqual([]);
  });

  it("refuses a request without App Check", async () => {
    await seedListed();
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const response = await server.post(
      path(LISTED_ID),
      { suggestedName: "Klinik Senyum Baru" },
      { appCheckToken: null, headers: { cookie } },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "app_check_required" });
    expect(await corrections()).toEqual([]);
  });

  it("answers 404 for a place that is not a Listed Provider", async () => {
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const response = await server.post(path(UNLISTED_ID), { suggestedName: "Nama Apa Saja" }, { headers: { cookie } });

    expect(response.status).toBe(404);
    expect(await corrections()).toEqual([]);
  });

  it("refuses an empty suggestion, a kota outside its province and an over-long name", async () => {
    await seedListed();
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const responses = await Promise.all([
      server.post(path(LISTED_ID), {}, { headers: { cookie } }),
      server.post(path(LISTED_ID), { suggestedName: "   " }, { headers: { cookie } }),
      server.post(
        path(LISTED_ID),
        { suggestedRegion: { provinceCode: "31", regencyCode: "35.78" } },
        { headers: { cookie } },
      ),
      server.post(path(LISTED_ID), { suggestedName: "x".repeat(121) }, { headers: { cookie } }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(await corrections()).toEqual([]);
  });

  it("creates exactly one open correction with the current values, and leaves the Provider unchanged", async () => {
    await seedListed();
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const response = await server.post(
      path(LISTED_ID),
      {
        suggestedName: "  Klinik Gigi Senyum Gubeng  ",
        suggestedRegion: { provinceCode: "35", regencyCode: "35.15" },
      },
      { headers: { cookie } },
    );
    const body = (await response.json()) as { id: string };

    expect(response.status).toBe(201);
    const docs = await server.firestore.collection(COLLECTIONS.nameCorrections).get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0]?.id).toBe(body.id);
    const doc = docs.docs[0]?.data() as NameCorrectionDoc;
    expect(doc).toMatchObject({
      placeId: LISTED_ID,
      suggestedName: "Klinik Gigi Senyum Gubeng",
      suggestedRegion: { provinceCode: "35", regencyCode: "35.15" },
      currentName: "Klinik Senyum Gubeng",
      currentRegion: { provinceCode: "35", regencyCode: "35.78" },
      status: "open",
    });
    expect(doc.suggesterUid).toEqual(expect.any(String));
    expect(doc.createdAt).toBeInstanceOf(Timestamp);

    const provider = (await server.firestore.collection(COLLECTIONS.providers).doc(LISTED_ID).get()).data();
    expect(provider).toEqual(listedProvider());
  });

  it("accepts a name-only suggestion without a Region", async () => {
    await seedListed();
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const response = await server.post(path(LISTED_ID), { suggestedName: "Klinik Baru" }, { headers: { cookie } });

    expect(response.status).toBe(201);
    const [doc] = await corrections();
    expect(doc?.suggestedName).toBe("Klinik Baru");
    expect(doc).not.toHaveProperty("suggestedRegion");
  });

  it("limits each account to a few corrections a day", async () => {
    await seedListed();
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await server.post(path(LISTED_ID), { suggestedName: `Nama ${i}` }, { headers: { cookie } });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(await corrections()).toHaveLength(10);
  });
});
