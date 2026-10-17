import { COLLECTIONS, type ProviderDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GoogleBlock, GoogleReview } from "../../server/adapters/places.ts";
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

function listedProvider(overrides: Partial<ProviderDoc> = {}): ProviderDoc {
  return {
    placeId: LISTED_ID,
    name: "Klinik Senyum Gubeng",
    nameSource: "testimonyAuthor",
    nameNormalized: "klinik senyum gubeng",
    region: { provinceCode: "35", regencyCode: "35.78" },
    location: { lat: -7.27, lng: 112.75, fetchedAt: NOW },
    providerType: "klinik",
    providerTypeSource: "inferred",
    claimStatus: "unclaimed",
    aggregates: {
      testimonyCount: 1,
      verifiedVisitCount: 1,
      averages: { service: 4.5, hygiene: 5, materialsEquipment: 4 },
      procedurePrices: {
        scaling: { count: 2, medianRupiah: 350_000, minRupiah: 300_000, maxRupiah: 400_000 },
      },
    },
    listedBy: "testimony",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function testimony(status: TestimonyDoc["status"], text: string): TestimonyDoc {
  return {
    placeId: LISTED_ID,
    region: { provinceCode: "35", regencyCode: "35.78" },
    providerType: "klinik",
    authorUid: `uid-${status}`,
    displayName: `Pasien ${status}`,
    status,
    verifiedVisit: true,
    consent: { termsVersion: "1", acceptedAt: NOW },
    authorFixRounds: 0,
    ratings: { service: 4, hygiene: 5, materialsEquipment: 4 },
    text,
    visitMonth: "2026-09",
    procedureCode: "scaling",
    pricePaidRupiah: 350_000,
    photoPaths: [],
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
  };
}

async function seed(provider: ProviderDoc, ...testimonies: TestimonyDoc[]) {
  const batch = server.firestore.batch();
  batch.set(server.firestore.collection(COLLECTIONS.providers).doc(provider.placeId), provider);
  for (const t of testimonies) batch.set(server.firestore.collection(COLLECTIONS.testimonies).doc(), t);
  await batch.commit();
}

/** Live Google facts the fake adapter returns; none may reach Firestore. */
const GOOGLE_FACTS: Omit<GoogleBlock, "placeId"> = {
  displayName: "drg. Google Display Name",
  types: ["dentist", "health"],
  formattedAddress: "Jl. Google Only Address 9, Surabaya",
  openNow: true,
  weekdayHours: ["Senin: 09.00–21.00"],
  nationalPhoneNumber: "0812-9999-0000",
  websiteUri: "https://google-only.example",
  rating: 4.6,
  userRatingCount: 88,
  googleMapsUri: "https://maps.google.com/?cid=google-only",
};

const GOOGLE_REVIEW: GoogleReview = {
  rating: 5,
  text: "Google-only review text",
  relativeTime: "2 minggu lalu",
  author: { name: "Google Reviewer", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.example/a" },
};

async function page(placeId: string) {
  const response = await fetch(new URL(`/provider/${placeId}`, server.baseUrl));
  return { response, html: await response.text() };
}

async function everyStoredDocument(): Promise<string> {
  const dump: unknown[] = [];
  for (const collection of await server.firestore.listCollections()) {
    for (const doc of (await collection.get()).docs) dump.push({ path: doc.ref.path, data: doc.data() });
  }
  return JSON.stringify(dump);
}

describe("GET /provider/:placeId", () => {
  it("server-renders a Listed Provider's name, Region, published Testimonies and prices, and is indexable", async () => {
    await seed(
      listedProvider(),
      testimony("published", "Dokternya teliti dan tempatnya bersih."),
      testimony("held", "Teks yang masih ditahan moderasi."),
    );

    const { response, html } = await page(LISTED_ID);

    expect(response.status).toBe(200);
    expect(html).toContain("Klinik Senyum Gubeng");
    expect(html).toContain("Kota Surabaya");
    expect(html).toContain("Dokternya teliti dan tempatnya bersih.");
    expect(html).not.toContain("Teks yang masih ditahan moderasi.");
    expect(html).toContain("Scaling (pembersihan karang gigi)");
    expect(html).not.toMatch(/<meta name="robots" content="noindex/);
  });

  it("marks a claimed Provider 'Diklaim pemilik' and shows its type without 'perkiraan'", async () => {
    await seed(listedProvider({ claimStatus: "claimed", claimId: "c1", providerTypeSource: "claimed" }));

    const { html } = await page(LISTED_ID);

    expect(html).toContain("Diklaim pemilik");
    expect(html).not.toContain("perkiraan");
  });

  it("serves a non-Listed Provider page with noindex", async () => {
    const { response, html } = await page(UNLISTED_ID);

    expect(response.status).toBe(200);
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
  });

  it("never calls Places while rendering, so crawlers cannot spend the budget", async () => {
    await seed(listedProvider());

    await page(LISTED_ID);
    await page(UNLISTED_ID);

    expect(server.fakes.places.detailsCalls).toEqual([]);
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("always links to the Provider's Google Maps page, without asking Google", async () => {
    await seed(listedProvider());

    const { html } = await page(LISTED_ID);

    expect(html).toContain(
      `https://www.google.com/maps/search/?api=1&amp;query=Klinik%20Senyum%20Gubeng&amp;query_place_id=${LISTED_ID}`,
    );
  });

  it("answers 404 for a malformed place id", async () => {
    const { response } = await page("not%20a%20place%3Cid%3E");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/providers/:placeId/google", () => {
  it("refuses a request without App Check and never calls Places", async () => {
    const response = await server.get(`/api/providers/${LISTED_ID}/google`, { appCheckToken: null });

    expect(response.status).toBe(401);
    expect(server.fakes.places.detailsCalls).toEqual([]);
  });

  it("returns Google's live facts through one Google block call, with the type inferred for a non-Listed Provider", async () => {
    server.fakes.places.respondWithGoogleBlock(GOOGLE_FACTS);

    const response = await server.get(`/api/providers/${UNLISTED_ID}/google`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(server.fakes.places.detailsCalls).toEqual([
      { method: "getGoogleBlock", placeId: UNLISTED_ID, language: "id" },
    ]);
    expect(body).toEqual({
      available: true,
      block: {
        displayName: "drg. Google Display Name",
        providerType: "privateDentist",
        formattedAddress: "Jl. Google Only Address 9, Surabaya",
        openNow: true,
        weekdayHours: ["Senin: 09.00–21.00"],
        nationalPhoneNumber: "0812-9999-0000",
        whatsappUri: "https://wa.me/6281299990000",
        websiteUri: "https://google-only.example",
        rating: 4.6,
        userRatingCount: 88,
        googleMapsUri: "https://maps.google.com/?cid=google-only",
      },
    });
  });

  it("offers no WhatsApp link for a landline number", async () => {
    server.fakes.places.respondWithGoogleBlock({ ...GOOGLE_FACTS, nationalPhoneNumber: "(031) 5012345" });

    const body = await (await server.get(`/api/providers/${UNLISTED_ID}/google`)).json();

    expect(body.block.nationalPhoneNumber).toBe("(031) 5012345");
    expect(body.block.whatsappUri).toBeUndefined();
  });

  it("returns the fallback state with the Maps link when the Google block cap is reached", async () => {
    await seed(listedProvider());
    server.fakes.places.respondWithGoogleBlock({ ok: false, reason: "cap_reached" });

    const response = await server.get(`/api/providers/${LISTED_ID}/google`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      reason: "cap_reached",
      googleMapsUri: `https://www.google.com/maps/search/?api=1&query=Klinik%20Senyum%20Gubeng&query_place_id=${LISTED_ID}`,
    });
  });

  it("refuses a malformed place id before calling Places", async () => {
    const response = await server.get("/api/providers/bad%20id/google");

    expect(response.status).toBe(404);
    expect(server.fakes.places.detailsCalls).toEqual([]);
  });
});

describe("GET /api/providers/:placeId/reviews", () => {
  it("refuses a request without App Check and never calls Places", async () => {
    const response = await server.get(`/api/providers/${LISTED_ID}/reviews`, { appCheckToken: null });

    expect(response.status).toBe(401);
    expect(server.fakes.places.detailsCalls).toEqual([]);
  });

  it("returns Google's reviews with their author attribution through the reviews-only call", async () => {
    server.fakes.places.respondWithReviews([GOOGLE_REVIEW]);

    const response = await server.get(`/api/providers/${UNLISTED_ID}/reviews`);

    expect(response.status).toBe(200);
    expect(server.fakes.places.detailsCalls).toEqual([
      { method: "getGoogleReviews", placeId: UNLISTED_ID, language: "id" },
    ]);
    expect(await response.json()).toEqual({ available: true, reviews: [GOOGLE_REVIEW] });
  });

  it("returns the fallback state when the Google Reviews cap is reached", async () => {
    server.fakes.places.respondWithReviews({ ok: false, reason: "cap_reached" });

    const body = await (await server.get(`/api/providers/${UNLISTED_ID}/reviews`)).json();

    expect(body).toMatchObject({ available: false, reason: "cap_reached" });
  });
});

describe("Provider page and Google routes together", () => {
  it("write no Google field to Firestore", async () => {
    await seed(listedProvider());
    server.fakes.places.respondWithGoogleBlock(GOOGLE_FACTS);
    server.fakes.places.respondWithReviews([GOOGLE_REVIEW]);

    await page(LISTED_ID);
    await server.get(`/api/providers/${LISTED_ID}/google`);
    await server.get(`/api/providers/${LISTED_ID}/reviews`);

    const stored = await everyStoredDocument();
    for (const value of [
      GOOGLE_FACTS.displayName,
      GOOGLE_FACTS.formattedAddress,
      GOOGLE_FACTS.nationalPhoneNumber,
      GOOGLE_FACTS.websiteUri,
      GOOGLE_FACTS.googleMapsUri,
      GOOGLE_REVIEW.text,
      GOOGLE_REVIEW.author.name,
    ]) {
      expect(stored).not.toContain(value);
    }
  });
});
