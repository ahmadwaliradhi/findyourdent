import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedProvider, seedTestimony } from "../support/fixtures.ts";
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
const rated = (testimonyCount: number, score: number, verifiedVisitCount = 0) => ({
  testimonyCount,
  verifiedVisitCount,
  averages: flat(score),
  procedurePrices: {} as never,
});

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
    await seedProvider(server.firestore, { placeId: "rs", providerType: "hospital", aggregates: rated(3, 4, 1) });
    await seedProvider(server.firestore, { placeId: "drg", providerType: "privateDentist", aggregates: rated(2, 4) });
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

  it("sorts by number of Testimonies by default and by shrunk aspect score on request", async () => {
    await seedProvider(server.firestore, { placeId: "one-perfect", aggregates: rated(1, 5) });
    await seedProvider(server.firestore, { placeId: "many-great", aggregates: rated(20, 4.8) });
    await seedProvider(server.firestore, { placeId: "mediocre", aggregates: rated(10, 3) });
    await seedProvider(server.firestore, { placeId: "unrated", aggregates: { ...rated(0, 0), averages: null } });

    expect((await directory()).rows).toEqual(["many-great", "mediocre", "one-perfect", "unrated"]);
    expect((await directory("?urut=skor")).rows).toEqual(["many-great", "one-perfect", "mediocre", "unrated"]);
    // Distance is sorted in the browser; the server sends the default order.
    expect((await directory("?urut=jarak")).rows).toEqual(["many-great", "mediocre", "one-perfect", "unrated"]);
  });

  it("shows the area, an inferred type as perkiraan, counts, and Diklaim pemilik for claimed Providers", async () => {
    await seedProvider(server.firestore, {
      placeId: "claimed",
      name: "Klinik Diklaim",
      claimStatus: "claimed",
      providerTypeSource: "claimed",
      aggregates: rated(7, 4, 3),
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
