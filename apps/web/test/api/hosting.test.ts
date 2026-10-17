import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

/** The name=value pair of a Set-Cookie header, or "" when there is none. */
function cookiePair(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

/**
 * Firebase Hosting fronts the web service and strips every request cookie except
 * `__session` (ADR-0008). These tests send only what Hosting would forward.
 */
describe("behind Firebase Hosting", () => {
  it("keeps the language toggle and the Guidance session id in the one __session cookie", async () => {
    const first = await server.post("/api/guidance", {
      complaintText: "Gigi ngilu kalau minum dingin",
      language: "id",
    });
    expect(first.status).toBe(200);
    const withSession = cookiePair(first);
    expect(withSession).toMatch(/^__session=/);

    const toggle = await fetch(new URL("/language", server.baseUrl), {
      method: "POST",
      headers: { cookie: withSession },
      body: new URLSearchParams({ lang: "en", redirectTo: "/" }),
      redirect: "manual",
    });
    const withLanguage = cookiePair(toggle);
    expect(withLanguage).toMatch(/^__session=/);

    const page = await fetch(new URL("/", server.baseUrl), { headers: { cookie: withLanguage } });
    expect(await page.text()).toMatch(/<html[^>]*lang="en"/);

    const second = await server.post(
      "/api/guidance",
      { complaintText: "Gigi ngilu kalau minum dingin", language: "en" },
      { headers: { cookie: withLanguage } },
    );
    expect(second.status).toBe(200);
    const [turn1, turn2] = server.fakes.agent.calls;
    expect(turn2?.sessionId).toBe(turn1?.sessionId);
  });
});

describe("health route", () => {
  // Cloud Run reserves some paths ending in "z", so /healthz may never reach the app.
  it("answers on /health", async () => {
    const response = await fetch(new URL("/health", server.baseUrl));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
