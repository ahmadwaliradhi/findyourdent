// Spec 09 (ADR-0011): only Proven Testimonies move the Shortlist and the directory.
// Testimonies go in through the posting API, so every order below comes from the
// aggregates the app itself computed, not from seeded numbers.
import type { Guidance } from "@findyourdent/contracts";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonySubmission } from "../../app/lib/testimony.ts";
import { shareToken } from "../../app/server/share.server.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
import type { PlaceSummary } from "../../server/adapters/places.ts";
import { jakartaDate } from "../../server/quota.ts";
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
  cookies.clear();
});

const TODAY = jakartaDate(Date.now());
/** Gubeng, Surabaya: where the Patient shares their location from. */
const GUBENG = { lat: -7.2756, lng: 112.7509 };
/** All three Providers stand at the same spot, so distance never decides between them. */
const SAME_SPOT = { lat: -7.2711, lng: 112.7509 };

const place = (placeId: string, displayName: string): PlaceSummary => ({
  placeId,
  displayName,
  formattedAddress: "Jl. Google Address, Surabaya",
  location: SAME_SPOT,
  types: ["dentist", "health"],
  googleMapsUri: `https://maps.google.com/?cid=${placeId}`,
});

// Place ids and names sort the same way, so any tie falls to Anggrek, then Bakung.
const ANGGREK = place("place-a-anggrek", "Klinik Gigi Anggrek");
const BAKUNG = place("place-b-bakung", "Klinik Gigi Bakung");
const CEMPAKA = place("place-c-cempaka", "Klinik Gigi Cempaka");

const { language: _stubLanguage, ...ROOT_CANAL_GUIDANCE } = STUB_GUIDANCE_RESPONSE.guidance as unknown as Guidance;

const cookies = new Map<string, string>();
async function cookieFor(author: string): Promise<string> {
  const known = cookies.get(author);
  if (known) return known;
  const cookie = await server.signInWithGoogle(`${author}@example.com`);
  cookies.set(author, cookie);
  return cookie;
}

/** A receipt-like JPEG with printed text, so no two receipts look alike to the Proof Fingerprint. */
async function receipt(label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640">
    <rect width="100%" height="100%" fill="#fdfcf7"/>
    <text x="24" y="60" font-size="28" font-family="sans-serif">${label}</text>
    <text x="24" y="120" font-size="20" font-family="monospace">${TODAY}  Scaling  Rp300.000</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

/**
 * Posts a published Testimony rating every aspect `score`. Proven means it carries a
 * Proof of Visit, which the stub Moderation reads as matching the Provider.
 */
async function post(author: string, provider: PlaceSummary, score: number, proven: boolean): Promise<void> {
  const body: TestimonySubmission = {
    placeId: provider.placeId,
    providerName: provider.displayName,
    region: { provinceCode: "35", regencyCode: "35.78" },
    ratings: { service: score, hygiene: score, materialsEquipment: score },
    text: "Dokternya sabar menjelaskan pilihan perawatan dan ruangannya bersih.",
    visitMonth: TODAY.slice(0, 7),
    procedureCode: "scaling",
    pricePaidRupiah: 300_000,
    displayName: `Pasien ${author}`,
    consent: { honestExperience: true, noOthersPersonalData: true },
  };
  const form = new FormData();
  form.set("testimony", JSON.stringify(body));
  if (proven) {
    const bytes = await receipt(`${provider.displayName}, struk ${author}`);
    form.set("proof", new File([new Uint8Array(bytes)], "struk", { type: "image/jpeg" }));
  }
  const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: { cookie: await cookieFor(author), [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ status: "published", verifiedVisit: proven });
}

/**
 * Anggrek and Bakung: three Proven Testimonies of 4 each, so they tie. Cempaka: three
 * Proven Testimonies of 2, which pulls the overall mean below the other two.
 */
async function postBaseline(): Promise<void> {
  for (const author of ["satu", "dua", "tiga"]) {
    await post(author, ANGGREK, 4, true);
    await post(author, BAKUNG, 4, true);
    await post(author, CEMPAKA, 2, true);
  }
}

async function shortlistOrder(): Promise<string[]> {
  server.fakes.places.respondWith([CEMPAKA, BAKUNG, ANGGREK]);
  const response = await server.post("/api/shortlist", {
    purpose: "shortlist",
    guidanceToken: shareToken(ROOT_CANAL_GUIDANCE, "test-share-link-secret"),
    location: GUBENG,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { providers: { placeId: string }[] };
  return body.providers.map((p) => p.placeId);
}

/** Row order of the server-rendered directory for a sort. */
async function directoryOrder(sort: "testimoni" | "skor"): Promise<string[]> {
  const response = await fetch(new URL(`/direktori?urut=${sort}`, server.baseUrl));
  expect(response.status).toBe(200);
  return [...(await response.text()).matchAll(/data-place-id="([^"]+)"/g)].map((m) => m[1] as string);
}

const directoryOrders = async () => ({
  mostTestimonies: await directoryOrder("testimoni"),
  score: await directoryOrder("skor"),
});

describe("only Proven Testimonies move the directory", () => {
  it("keeps both sorts when unproven Testimonies are added, and changes them when Proven ones are", async () => {
    await postBaseline();
    const before = await directoryOrders();
    expect(before).toEqual({
      mostTestimonies: [ANGGREK.placeId, BAKUNG.placeId, CEMPAKA.placeId],
      score: [ANGGREK.placeId, BAKUNG.placeId, CEMPAKA.placeId],
    });

    await post("empat", BAKUNG, 5, false);
    await post("lima", BAKUNG, 5, false);
    expect(await directoryOrders()).toEqual(before);

    await post("enam", BAKUNG, 5, true);
    expect(await directoryOrders()).toEqual({
      mostTestimonies: [BAKUNG.placeId, ANGGREK.placeId, CEMPAKA.placeId],
      score: [BAKUNG.placeId, ANGGREK.placeId, CEMPAKA.placeId],
    });
  });
});

describe("only Proven Testimonies move the Shortlist", () => {
  it("keeps the order when unproven Testimonies are added, and changes it when Proven ones are", async () => {
    await postBaseline();
    const before = await shortlistOrder();
    expect(before).toEqual([ANGGREK.placeId, BAKUNG.placeId, CEMPAKA.placeId]);

    // Buzzers: five-star Testimonies without a Proof of Visit.
    await post("empat", BAKUNG, 5, false);
    await post("lima", BAKUNG, 5, false);
    expect(await shortlistOrder()).toEqual(before);

    await post("enam", BAKUNG, 5, true);
    expect(await shortlistOrder()).toEqual([BAKUNG.placeId, ANGGREK.placeId, CEMPAKA.placeId]);
  });
});
