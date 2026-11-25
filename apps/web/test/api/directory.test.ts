import type { ModerationDecision } from "@findyourdent/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonySubmission } from "../../app/lib/testimony.ts";
import {
  distinctTestimonyText,
  seedProvider,
  seedTestimony,
  submittedBeforeDetectionWindow,
} from "../support/fixtures.ts";
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

const flat = (score: number) => ({ service: score, hygiene: score, materialsEquipment: score });
/** Aggregates as computeAggregates leaves them: averages only from the third Proven Testimony. */
const rated = (verifiedVisitCount: number, score: number, unproven = 0) => ({
  testimonyCount: verifiedVisitCount + unproven,
  verifiedVisitCount,
  averages: verifiedVisitCount >= 3 ? flat(score) : null,
  procedurePrices: {} as never,
});

const PUBLISH: ModerationDecision = {
  decision: "publish",
  ruleCodes: [],
  flaggedSpans: [],
  confidence: 0.95,
  authorMessage: "Terima kasih!",
};
/** The agent read a receipt from the right clinic in the visit month: the Testimony is Proven. */
const ACCEPTED: ModerationDecision = {
  ...PUBLISH,
  proofOfVisit: {
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "Klinik Gigi",
    proofDate: "2026-09-12",
    clinicNameMatches: true,
  },
};

/** Each Patient's own receipt: one file twice at a place would be held as possible reuse. */
const receiptOf = (patient: string) => Buffer.from(`%PDF-1.4\n% ${patient}\n%%EOF\n`);

/**
 * Publishes a Testimony through the web API from a new Patient, with an accepted Proof of
 * Visit when `proven`, so the Provider's aggregates are recomputed as in production.
 */
let published = 0;

async function publish(placeId: string, author: string, proven: boolean, rating: [number, number, number]) {
  published += 1;
  server.fakes.agent.respondToModerationWith(proven ? ACCEPTED : PUBLISH);
  const cookie = await server.signInWithGoogle(`${author}@example.com`);
  const testimony: TestimonySubmission = {
    placeId,
    providerName: `Klinik Gigi ${placeId}`,
    region: { provinceCode: "31", regencyCode: "31.71" },
    ratings: { service: rating[0], hygiene: rating[1], materialsEquipment: rating[2] },
    // A text of its own: one text twice at a place is held as templated (D2).
    text: distinctTestimonyText(published),
    visitMonth: "2026-09",
    displayName: "Pasien",
    consent: { honestExperience: true, noOthersPersonalData: true },
  };
  const form = new FormData();
  form.set("testimony", JSON.stringify(testimony));
  if (proven) {
    const receipt = receiptOf(`${placeId} ${author}`);
    form.set("proof", new File([new Uint8Array(receipt)], "struk.pdf", { type: "application/pdf" }));
  }
  const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  expect(response.status).toBe(201);
  const stored = (await response.json()) as { testimonyId: string };
  expect(stored).toMatchObject({ status: "published", verifiedVisit: proven });
  await submittedBeforeDetectionWindow(server.firestore, stored.testimonyId);
}

async function publishMany(
  placeId: string,
  author: string,
  proven: boolean,
  n: number,
  rating: [number, number, number],
) {
  for (let i = 0; i < n; i++) await publish(placeId, `${author}-${i}`, proven, rating);
}

/** Server-rendered directory HTML; every request must leave the fake Places adapter untouched. */
async function directory(query = ""): Promise<{ html: string; rows: string[] }> {
  const response = await fetch(new URL(`/direktori${query}`, server.baseUrl));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(server.fakes.places.calls).toEqual([]);
  expect(html).not.toContain("fetchedAt");
  const rows = [...html.matchAll(/data-place-id="([^"]+)"/g)].map((m) => m[1] as string);
  return { html, rows };
}

describe("GET /direktori", () => {
  it("lists Listed Providers only, with their first-party name and stored coordinates but no fetch date", async () => {
    const listed = await seedProvider(server.firestore, {
      placeId: "place-listed",
      name: "Klinik Gigi Senyum",
      aggregates: rated(2, 4.5),
      location: { lat: -6.18, lng: 106.83, fetchedAt: new Date() } as never,
    });
    // A Testimony whose Provider never became Listed must not create a directory row.
    await seedTestimony(server.firestore, { ...listed, placeId: "place-not-listed" });

    const { html, rows } = await directory();

    expect(rows).toEqual(["place-listed"]);
    expect(html).toContain("Klinik Gigi Senyum");
    expect(html).toContain('href="/tempat/place-listed"');
    expect(html).toContain("106.83");
    expect(html).not.toContain("place-not-listed");
  });

  it("narrows by province, kota and kecamatan", async () => {
    await seedProvider(server.firestore, {
      placeId: "jakpus-gambir",
      region: { provinceCode: "31", regencyCode: "31.71", districtCode: "31.71.01" },
    });
    await seedProvider(server.firestore, {
      placeId: "jakpus-other",
      region: { provinceCode: "31", regencyCode: "31.71", districtCode: "31.71.02" },
    });
    await seedProvider(server.firestore, { placeId: "jaksel", region: { provinceCode: "31", regencyCode: "31.74" } });
    await seedProvider(server.firestore, { placeId: "bandung", region: { provinceCode: "32", regencyCode: "32.73" } });

    expect((await directory("?provinsi=32")).rows).toEqual(["bandung"]);
    expect((await directory("?provinsi=31")).rows.sort()).toEqual(["jakpus-gambir", "jakpus-other", "jaksel"]);
    expect((await directory("?kota=31.71")).rows.sort()).toEqual(["jakpus-gambir", "jakpus-other"]);
    expect((await directory("?kota=31.71&kecamatan=31.71.01")).rows).toEqual(["jakpus-gambir"]);
  });

  it("narrows by procedure from Testimony prices or the owner's published services", async () => {
    const price = { count: 1, medianRupiah: 300_000, minRupiah: 300_000, maxRupiah: 300_000 };
    await seedProvider(server.firestore, {
      placeId: "priced",
      aggregates: { ...rated(1, 4), procedurePrices: { scaling: price } as never },
    });
    await seedProvider(server.firestore, {
      placeId: "owner-listed",
      ownerFacts: { services: ["scaling"], moderationStatus: "published", updatedAt: new Date() } as never,
    });
    await seedProvider(server.firestore, {
      placeId: "owner-held",
      ownerFacts: { services: ["scaling"], moderationStatus: "held", updatedAt: new Date() } as never,
    });
    await seedProvider(server.firestore, { placeId: "other" });

    expect((await directory("?prosedur=scaling")).rows.sort()).toEqual(["owner-listed", "priced"]);
  });

  it("narrows by Provider type and by Kunjungan terbukti", async () => {
    await seedProvider(server.firestore, { placeId: "rs", providerType: "hospital", aggregates: rated(2, 4, 1) });
    await seedProvider(server.firestore, {
      placeId: "drg",
      providerType: "privateDentist",
      aggregates: rated(0, 4, 2),
    });
    await seedProvider(server.firestore, { placeId: "klinik", providerType: "klinik", aggregates: rated(1, 4, 1) });

    expect((await directory("?jenis=privateDentist")).rows).toEqual(["drg"]);
    expect((await directory("?terbukti=1")).rows).toEqual(["rs", "klinik"]);
    expect((await directory("?jenis=hospital&terbukti=1")).rows).toEqual(["rs"]);
  });

  it("searches by normalised name prefix, not by a word in the middle", async () => {
    await seedProvider(server.firestore, { placeId: "sehat", name: "Klinik Gigi Sehat" });
    await seedProvider(server.firestore, { placeId: "ceria", name: "Klinik Ceria" });

    expect((await directory(`?q=${encodeURIComponent("  KLINIK gígi")}`)).rows).toEqual(["sehat"]);
    expect((await directory("?q=klinik")).rows.sort()).toEqual(["ceria", "sehat"]);
    expect((await directory("?q=sehat")).rows).toEqual([]);
  });

  it("sorts by number of Proven Testimonies by default and by shrunk aspect score on request", async () => {
    await seedProvider(server.firestore, { placeId: "few-perfect", aggregates: rated(3, 5) });
    await seedProvider(server.firestore, { placeId: "many-great", aggregates: rated(20, 4.8) });
    await seedProvider(server.firestore, { placeId: "mediocre", aggregates: rated(10, 3) });
    // Many Testimonies, too few of them Proven for averages.
    await seedProvider(server.firestore, { placeId: "unrated", aggregates: rated(2, 0, 30) });

    expect((await directory()).rows).toEqual(["many-great", "mediocre", "few-perfect", "unrated"]);
    // The prior mean is (3*5 + 20*4.8 + 10*3) / 33 = 4.27: the unrated Provider sits there,
    // below the two shrunk scores above it and above the mediocre one, and shows no score.
    const { html, rows } = await directory("?urut=skor");
    expect(rows).toEqual(["many-great", "few-perfect", "unrated", "mediocre"]);
    expect(html.match(/>Skor \d/g)).toHaveLength(3);
    // Distance is sorted in the browser; the server sends the default order.
    expect((await directory("?urut=jarak")).rows).toEqual(["many-great", "mediocre", "few-perfect", "unrated"]);
  });

  it("moves no Provider in the Testimony sort for unproven Testimonies, and moves it for Proven ones (spec 09)", async () => {
    await seedProvider(server.firestore, { placeId: "klinik-a", aggregates: rated(5, 4) });
    await publishMany("klinik-b", "b", true, 3, [4, 4, 4]);
    const order = async () => (await directory()).rows;
    expect(await order()).toEqual(["klinik-a", "klinik-b"]);

    // Buzzer reviews: counted over all Testimonies (3 + 5 = 8 against 5) they would put
    // klinik-b first. Unproven, they move nothing: 3 Proven against 5.
    await publishMany("klinik-b", "buzzer", false, 5, [5, 5, 5]);
    expect(await order()).toEqual(["klinik-a", "klinik-b"]);

    // Three real visits: 6 Proven against 5.
    await publishMany("klinik-b", "patient", true, 3, [5, 5, 5]);
    expect(await order()).toEqual(["klinik-b", "klinik-a"]);
  });

  it("moves no Provider in the score sort for unproven Testimonies, and moves it for Proven ones (spec 09)", async () => {
    // klinik-c only pulls the prior down, so the prior's weight decides klinik-b's score.
    await seedProvider(server.firestore, { placeId: "klinik-a", aggregates: rated(10, 4) });
    await seedProvider(server.firestore, { placeId: "klinik-c", aggregates: rated(20, 1) });
    await publishMany("klinik-b", "b", true, 3, [5, 4, 4]);
    const order = async () => (await directory("?urut=skor")).rows;
    // Prior (10*4 + 20*1 + 3*4.33) / 33 = 2.21; a (3*2.21 + 10*4) / 13 = 3.59,
    // b (3*2.21 + 3*4.33) / 6 = 3.27.
    expect(await order()).toEqual(["klinik-a", "klinik-b", "klinik-c"]);

    // Buzzer reviews. Weighted by every Testimony (b: 10 at its Proven average 4.33), the
    // prior would be (40 + 20 + 43.3) / 40 = 2.58, a 3.67 and b (3*2.58 + 43.3) / 13 = 3.93:
    // klinik-b first. Weighted by Proven Testimonies only, nothing changes from above.
    await publishMany("klinik-b", "buzzer", false, 7, [5, 5, 5]);
    expect(await order()).toEqual(["klinik-a", "klinik-b", "klinik-c"]);

    // Three real visits: b has 6 Proven averaging (5 + 4.5 + 4.5) / 3 = 4.67, the prior is
    // (40 + 20 + 28) / 36 = 2.44, a (3*2.44 + 40) / 13 = 3.64 and b (3*2.44 + 28) / 9 = 3.93.
    await publishMany("klinik-b", "patient", true, 3, [5, 5, 5]);
    expect(await order()).toEqual(["klinik-b", "klinik-a", "klinik-c"]);
  });

  it("lists a rated Provider whose score equals the prior mean above the unrated ones in the score sort", async () => {
    // The only rated Provider: the prior mean is its own average, 3.97, and its shrunk score
    // (3*3.97 + 4*3.97) / 7 lands one floating-point step below that, at 3.9699999999999998.
    await seedProvider(server.firestore, {
      placeId: "rated",
      name: "Klinik Gigi Zebra",
      aggregates: {
        testimonyCount: 4,
        verifiedVisitCount: 4,
        averages: { service: 4.48, hygiene: 3.55, materialsEquipment: 3.88 },
        procedurePrices: {} as never,
      },
    });
    await seedProvider(server.firestore, { placeId: "two-proven", name: "Klinik Gigi Yakin", aggregates: rated(2, 0) });
    await seedProvider(server.firestore, { placeId: "none-b", name: "Klinik Gigi Bening", aggregates: rated(0, 0, 3) });
    await seedProvider(server.firestore, { placeId: "none-a", name: "Klinik Gigi Asri" });

    // All four rank at 3.97: the tie goes to more Proven Testimonies, then to the name.
    const { html, rows } = await directory("?urut=skor");
    expect(rows).toEqual(["rated", "two-proven", "none-a", "none-b"]);
    expect(html.match(/>Skor \d/g)).toHaveLength(1);
  });

  it("shows the area, an inferred type as perkiraan, counts, and Diklaim pemilik for claimed Providers", async () => {
    await seedProvider(server.firestore, {
      placeId: "claimed",
      name: "Klinik Diklaim",
      claimStatus: "claimed",
      providerTypeSource: "claimed",
      aggregates: rated(3, 4, 4),
    });
    const { html: claimedHtml } = await directory("?q=klinik%20diklaim");
    expect(claimedHtml).toContain("Diklaim pemilik");
    expect(claimedHtml).toContain("Kota Administrasi Jakarta Pusat");
    expect(claimedHtml).toContain("7 testimoni");
    expect(claimedHtml).toContain("3 Kunjungan terbukti");
    expect(claimedHtml).not.toMatch(/>perkiraan</);

    await server.reset();
    await seedProvider(server.firestore, { placeId: "unclaimed", name: "Klinik Biasa" });
    const { html } = await directory();
    expect(html).not.toContain("Diklaim pemilik");
    expect(html).toMatch(/>perkiraan</);
  });

  it("shows an empty state with a link to write a Testimony, and an Indonesian title naming the kota", async () => {
    await seedProvider(server.firestore, { placeId: "jakpus", region: { provinceCode: "31", regencyCode: "31.71" } });

    const { html, rows } = await directory("?kota=32.73");

    expect(rows).toEqual([]);
    expect(html).toContain("Belum ada tempat yang cocok");
    expect(html).toMatch(/<a[^>]+href="\/ceritakan"[^>]*>Ceritakan pengalamanmu<\/a>/);
    expect(html).toMatch(/<title>[^<]*Kota Bandung[^<]*<\/title>/);
  });
});
