import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedProvider } from "../support/fixtures.ts";
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

describe("GET /sitemap.xml", () => {
  it("lists exactly the Listed Provider pages, plus the landing page, the directory and About", async () => {
    const first = await seedProvider(server.firestore, { placeId: "ChIJ-first" });
    await seedProvider(server.firestore, { placeId: "ChIJ second&odd" });

    const response = await fetch(new URL("/sitemap.xml", server.baseUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/xml/);
    const xml = await response.text();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(
      [
        `${server.baseUrl}/`,
        `${server.baseUrl}/direktori`,
        `${server.baseUrl}/tentang`,
        `${server.baseUrl}/tempat/${first.placeId}`,
        `${server.baseUrl}/tempat/ChIJ%20second%26odd`,
      ].sort(),
    );
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("leaves out Privacy and Terms until legal review", async () => {
    const xml = await (await fetch(new URL("/sitemap.xml", server.baseUrl))).text();

    expect(xml).toContain(`<loc>${server.baseUrl}/tentang</loc>`);
    expect(xml).not.toContain("/privasi");
    expect(xml).not.toContain("/syarat");
  });

  it("is still valid with no Listed Providers yet", async () => {
    const xml = await (await fetch(new URL("/sitemap.xml", server.baseUrl))).text();

    expect([...xml.matchAll(/<loc>/g)]).toHaveLength(3);
  });
});
