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

async function page(placeId: string): Promise<{ status: number; html: string }> {
  const response = await fetch(new URL(`/tempat/${encodeURIComponent(placeId)}`, server.baseUrl));
  return { status: response.status, html: await response.text() };
}

function metaContent(html: string, attribute: "name" | "property", key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`));
  return tag?.[1];
}

async function seedSurabayaClinic() {
  return seedProvider(server.firestore, {
    placeId: "ChIJ-surabaya-senyum",
    name: "Klinik Gigi Senyum Sehat",
    region: { provinceCode: "35", regencyCode: "35.78" },
    providerType: "klinik",
    providerTypeSource: "inferred",
    claimStatus: "claimed",
    aggregates: {
      testimonyCount: 2,
      verifiedVisitCount: 1,
      averages: { service: 4.5, hygiene: 5, materialsEquipment: 4 },
      procedurePrices: {} as never,
    },
  });
}

describe("Listed Provider page", () => {
  it("server-renders the first-party name, Region, type and published Testimonies in full, newest first", async () => {
    const provider = await seedSurabayaClinic();
    const older = await seedTestimony(server.firestore, provider, {
      text: "Tambal gigi geraham, dokternya sabar menjelaskan pilihan bahan.",
      verifiedVisit: true,
      publishedAt: new Date("2026-09-01T03:00:00Z"),
    });
    const newer = await seedTestimony(server.firestore, provider, {
      text: "Scaling cepat dan ruangannya bersih sekali.",
      publishedAt: new Date("2026-10-01T03:00:00Z"),
    });

    const { status, html } = await page(provider.placeId);

    expect(status).toBe(200);
    expect(html).toContain("Klinik Gigi Senyum Sehat");
    expect(html).toContain("Kota Surabaya");
    expect(html).toContain("perkiraan");
    expect(html).toContain("Diklaim pemilik");
    expect(html).toContain(older.text);
    expect(html).toContain(newer.text);
    expect(html.indexOf(newer.text)).toBeLessThan(html.indexOf(older.text));
    expect(html).toContain(`id="testimoni-${older.id}"`);
    expect(html).toContain(`id="testimoni-${newer.id}"`);
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("never shows held, removed, hidden, deleted or unpublished Testimonies", async () => {
    const provider = await seedSurabayaClinic();
    const shown = await seedTestimony(server.firestore, provider, { text: "Yang ini terbit dan boleh dibaca." });
    for (const status of ["held", "removed", "hidden", "deleted", "submitted", "rejected", "needsAuthorFix"] as const) {
      await seedTestimony(server.firestore, provider, { status, text: `Rahasia status ${status} tidak boleh tampil.` });
    }

    const { html } = await page(provider.placeId);

    expect(html).toContain(shown.text);
    expect(html).not.toContain("Rahasia status");
  });

  it("gives WhatsApp a preview built from the name, area and aspect scores only", async () => {
    const provider = await seedSurabayaClinic();
    await seedTestimony(server.firestore, provider);

    const { html } = await page(provider.placeId);

    const title = metaContent(html, "property", "og:title");
    const description = metaContent(html, "property", "og:description") ?? "";
    expect(title).toContain("Klinik Gigi Senyum Sehat");
    expect(description).toContain("Kota Surabaya");
    expect(description).toMatch(/4,5/);
    expect(description).toMatch(/5,0/);
    expect(description).toMatch(/4,0/);
    expect(metaContent(html, "property", "og:type")).toBe("website");
    expect(metaContent(html, "property", "og:site_name")).toBe("FindYourDent");
    expect(metaContent(html, "property", "og:url")).toBe(`${server.baseUrl}/tempat/ChIJ-surabaya-senyum`);
    expect(metaContent(html, "name", "twitter:card")).toBe("summary");
    expect(metaContent(html, "name", "twitter:title")).toBe(title);
    expect(metaContent(html, "name", "description")).toBe(description);
    expect(html).toMatch(/<title>[^<]*Klinik Gigi Senyum Sehat[^<]*<\/title>/);
    expect(html).not.toMatch(/googleusercontent|maps\.googleapis|places\.googleapis/);
    expect(html).not.toMatch(/<meta name="robots" content="noindex"/);
  });

  it("serves a place that is not a Listed Provider as noindex, without calling Places", async () => {
    // Shortlist cards link to every Provider; without FindYourDent content the page is noindex (spec 02).
    const { status, html } = await page("ChIJ-not-listed");

    expect(status).toBe(200);
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
    expect(server.fakes.places.calls).toEqual([]);
    expect(server.fakes.places.detailsCalls).toEqual([]);
  });
});
