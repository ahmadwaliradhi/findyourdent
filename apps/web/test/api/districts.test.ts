import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

describe("GET /api/regions/:regencyCode/districts", () => {
  it("lists the kecamatan of one kota/kabupaten by code and name, in list order", async () => {
    const response = await fetch(new URL("/api/regions/31.71/districts", server.baseUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/public/);
    const body = (await response.json()) as { districts: { code: string; name: string }[] };
    expect(body.districts).toEqual([
      { code: "31.71.01", name: "Gambir" },
      { code: "31.71.02", name: "Sawah Besar" },
      { code: "31.71.03", name: "Kemayoran" },
      { code: "31.71.04", name: "Senen" },
      { code: "31.71.05", name: "Cempaka Putih" },
      { code: "31.71.06", name: "Menteng" },
      { code: "31.71.07", name: "Tanah Abang" },
      { code: "31.71.08", name: "Johar Baru" },
    ]);
  });

  it("answers 404 for a code that is not a kota/kabupaten", async () => {
    for (const code of ["31", "99.99", "31.71.01"]) {
      const response = await fetch(new URL(`/api/regions/${code}/districts`, server.baseUrl));
      expect(response.status, code).toBe(404);
    }
  });
});
