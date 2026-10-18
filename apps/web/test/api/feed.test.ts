import type { TestimonyStatus } from "@findyourdent/contracts/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FeedItem } from "../../app/lib/feed.ts";
import { type ProviderFixture, seedProvider, seedTestimony } from "../support/fixtures.ts";
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

// Spec 04: the landing page and the feed never call Google Places.
afterEach(() => {
  expect(server.fakes.places.calls).toEqual([]);
});

interface FeedBody {
  items: FeedItem[];
  nextCursor: string | null;
}

async function getFeed(query = ""): Promise<{ status: number; body: FeedBody; raw: string }> {
  const response = await fetch(new URL(`/api/feed${query}`, server.baseUrl));
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw) as FeedBody, raw };
}

async function getLanding(query = ""): Promise<string> {
  const response = await fetch(new URL(`/${query}`, server.baseUrl));
  expect(response.status).toBe(200);
  return response.text();
}

const JAKARTA_PUSAT = { provinceCode: "31", regencyCode: "31.71", districtCode: "31.71.01" };
const JAKARTA_SELATAN = { provinceCode: "31", regencyCode: "31.74", districtCode: "31.74.01" };
const BANDUNG = { provinceCode: "32", regencyCode: "32.73" };

describe("GET /api/feed", () => {
  it("returns published Testimonies with the Listed Provider's first-party name, and never the author uid", async () => {
    const provider = await seedProvider(server.firestore, {
      name: "Klinik Gigi Senyum Menteng",
      region: JAKARTA_PUSAT,
    });
    const testimony = await seedTestimony(server.firestore, provider, {
      text: "Dokter Rina sabar sekali menjelaskan perawatan saluran akar.",
      procedureCode: "root_canal_treatment",
      pricePaidRupiah: 2_500_000,
      verifiedVisit: true,
      displayName: "Sari W.",
    });

    const { status, body, raw } = await getFeed();

    expect(status).toBe(200);
    expect(body).toEqual({
      items: [
        {
          id: testimony.id,
          placeId: provider.placeId,
          providerName: "Klinik Gigi Senyum Menteng",
          providerType: "klinik",
          region: JAKARTA_PUSAT,
          ratings: testimony.ratings,
          excerpt: "Dokter Rina sabar sekali menjelaskan perawatan saluran akar.",
          visitMonth: "2026-09",
          procedureCode: "root_canal_treatment",
          pricePaidRupiah: 2_500_000,
          verifiedVisit: true,
          displayName: "Sari W.",
        },
      ],
      nextCursor: null,
    });
    expect(raw).not.toContain("authorUid");
    expect(raw).not.toContain(testimony.authorUid);
  });

  it("trims long text to an excerpt", async () => {
    const provider = await seedProvider(server.firestore);
    await seedTestimony(server.firestore, provider, { text: "Pelayanan ramah dan cepat. ".repeat(60) });

    const { body } = await getFeed();

    const [item] = body.items;
    expect(item?.excerpt.length).toBeLessThanOrEqual(281);
    expect(item?.excerpt.endsWith("…")).toBe(true);
  });

  it("never shows Testimonies that are not published", async () => {
    const provider = await seedProvider(server.firestore);
    const published = await seedTestimony(server.firestore, provider, { text: "Yang tampil" });
    const hiddenStatuses: TestimonyStatus[] = [
      "removed",
      "hidden",
      "held",
      "deleted",
      "submitted",
      "rejected",
      "needsAuthorFix",
    ];
    for (const status of hiddenStatuses) {
      await seedTestimony(server.firestore, provider, { status, text: `Tidak boleh tampil: ${status}` });
    }

    const { body, raw } = await getFeed();
    const html = await getLanding();

    expect(body.items.map((i) => i.id)).toEqual([published.id]);
    for (const status of hiddenStatuses) {
      expect(raw).not.toContain(`Tidak boleh tampil: ${status}`);
      expect(html).not.toContain(`Tidak boleh tampil: ${status}`);
    }
  });

  describe("filters", () => {
    let pusat: ProviderFixture;
    let selatan: ProviderFixture;
    let bandung: ProviderFixture;
    const ids: Record<string, string> = {};

    beforeEach(async () => {
      pusat = await seedProvider(server.firestore, { name: "Klinik Pusat", region: JAKARTA_PUSAT });
      selatan = await seedProvider(server.firestore, {
        name: "Drg. Selatan",
        region: JAKARTA_SELATAN,
        providerType: "privateDentist",
      });
      bandung = await seedProvider(server.firestore, {
        name: "RS Bandung",
        region: BANDUNG,
        providerType: "hospital",
      });
      ids.pusat = (await seedTestimony(server.firestore, pusat, { procedureCode: "scaling" })).id;
      ids.pusatVerified = (await seedTestimony(server.firestore, pusat, { verifiedVisit: true })).id;
      ids.selatan = (await seedTestimony(server.firestore, selatan, { procedureCode: "scaling" })).id;
      ids.bandung = (await seedTestimony(server.firestore, bandung, { verifiedVisit: true })).id;
    });

    const cases: [string, string, string[]][] = [
      ["province", "?provinsi=32", ["bandung"]],
      ["kota", "?kota=31.74", ["selatan"]],
      ["kecamatan", "?kota=31.71&kecamatan=31.71.01", ["pusatVerified", "pusat"]],
      ["procedure", "?prosedur=scaling", ["selatan", "pusat"]],
      ["Provider type", "?jenis=hospital", ["bandung"]],
      ["Kunjungan terbukti", "?terbukti=1", ["bandung", "pusatVerified"]],
      ["several at once", "?provinsi=31&terbukti=1", ["pusatVerified"]],
    ];
    for (const [name, query, expected] of cases) {
      it(`by ${name} returns only matching Testimonies, newest first`, async () => {
        const { status, body } = await getFeed(query);
        expect(status).toBe(200);
        expect(body.items.map((i) => i.id)).toEqual(expected.map((key) => ids[key]));
      });
    }

    it("by kota narrows the server-rendered landing feed", async () => {
      const html = await getLanding("?kota=31.74");
      expect(html).toContain("Drg. Selatan");
      expect(html).not.toContain("Klinik Pusat");
      expect(html).not.toContain("RS Bandung");
      // The filtered view is indexable with the kota in its title.
      expect(html).toMatch(/<title>[^<]*Kota Administrasi Jakarta Selatan[^<]*<\/title>/);
    });

    it("shows the empty state when nothing matches", async () => {
      const { body } = await getFeed("?provinsi=11");
      expect(body).toEqual({ items: [], nextCursor: null });

      const html = await getLanding("?provinsi=11");
      expect(html).toContain("Belum ada Testimoni untuk pilihan ini");
      expect(html).toContain("Ceritakan pengalamanmu");
    });
  });

  it("walks every page newest first with no duplicates", async () => {
    const provider = await seedProvider(server.firestore);
    const base = Date.UTC(2026, 9, 1);
    const seeded: { id: string; publishedAt: number }[] = [];
    for (let i = 0; i < 23; i++) {
      // Testimonies come in pairs sharing a publish time, so the document id must break the tie.
      const publishedAt = base + Math.floor(i / 2) * 60_000;
      const t = await seedTestimony(server.firestore, provider, { publishedAt: new Date(publishedAt) });
      seeded.push({ id: t.id, publishedAt });
    }
    const expected = [...seeded]
      .sort((a, b) => b.publishedAt - a.publishedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .map((t) => t.id);

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const { status, body }: { status: number; body: FeedBody } = await getFeed(query);
      expect(status).toBe(200);
      seen.push(...body.items.map((i) => i.id));
      pageSizes.push(body.items.length);
      cursor = body.nextCursor;
    } while (cursor);

    expect(pageSizes).toEqual([10, 10, 3]);
    expect(seen).toEqual(expected);
  });

  it("keeps the filters while paging", async () => {
    const pusat = await seedProvider(server.firestore, { region: JAKARTA_PUSAT });
    const bandung = await seedProvider(server.firestore, { region: BANDUNG });
    for (let i = 0; i < 12; i++) {
      await seedTestimony(server.firestore, pusat);
      await seedTestimony(server.firestore, bandung);
    }

    const first = await getFeed("?kota=32.73");
    const second = await getFeed(`?kota=32.73&cursor=${first.body.nextCursor}`);

    expect(first.body.items).toHaveLength(10);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
    for (const item of [...first.body.items, ...second.body.items]) expect(item.placeId).toBe(bandung.placeId);
  });

  it("refuses a cursor it did not make", async () => {
    const response = await fetch(new URL("/api/feed?cursor=bm9wZQ", server.baseUrl));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_cursor" });
  });
});

describe("landing page", () => {
  it("server-renders the latest Testimonies with the first-party Provider name and links", async () => {
    const provider = await seedProvider(server.firestore, {
      name: "Klinik Gigi Senyum Menteng",
      region: JAKARTA_PUSAT,
    });
    const testimony = await seedTestimony(server.firestore, provider, {
      text: "Dokter Rina sabar sekali menjelaskan perawatan saluran akar.",
      verifiedVisit: true,
    });

    const html = await getLanding();

    expect(html).toContain("Klinik Gigi Senyum Menteng");
    expect(html).toContain("Dokter Rina sabar sekali menjelaskan perawatan saluran akar.");
    expect(html).toContain("Kunjungan terbukti");
    expect(html).toContain(`href="/tempat/${provider.placeId}"`);
    expect(html).toContain(`href="/tempat/${provider.placeId}#testimoni-${testimony.id}"`);
    expect(html).not.toContain(testimony.authorUid);
    // The agent entry still leads the page.
    expect(html).toContain('name="complaintText"');
  });

  it("labels each card Kunjungan terbukti or Belum terbukti, linking Belum terbukti to the verification page", async () => {
    const provider = await seedProvider(server.firestore, { region: JAKARTA_PUSAT });
    const proven = await seedTestimony(server.firestore, provider, { verifiedVisit: true });
    const unproven = await seedTestimony(server.firestore, provider);

    const html = await getLanding();

    const card = (id: string) => {
      const start = html.indexOf(`id="feed-${id}"`);
      expect(start).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf("</article>", start));
    };
    expect(card(proven.id)).toContain("Kunjungan terbukti");
    expect(card(proven.id)).not.toContain("Belum terbukti");
    expect(card(unproven.id)).not.toContain("Kunjungan terbukti");
    expect(card(unproven.id)).toMatch(/<a [^>]*href="\/verifikasi-testimoni"[^>]*>(?:(?!<\/a>).)*Belum terbukti/s);
  });

  it("offers more when there is another page", async () => {
    const provider = await seedProvider(server.firestore);
    for (let i = 0; i < 11; i++) await seedTestimony(server.firestore, provider);

    const html = await getLanding();

    expect(html).toContain("Muat lebih banyak");
  });
});
