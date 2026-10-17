import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

const BODY = { complaintText: "Gigi depan ngilu kalau minum dingin", language: "id" };

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

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

/** One Guidance request from a fresh browser: its own App Check token and no session cookie. */
function freshBrowser() {
  return server.post("/api/guidance", BODY, { appCheckToken: server.appCheckToken() });
}

describe("Guidance rate limits (10 sessions an hour)", () => {
  it("refuses the 11th Guidance session from one App Check token with 'coba lagi nanti', then resets after the hour", async () => {
    const token = server.appCheckToken();
    for (let i = 0; i < 10; i++) {
      const ok = await server.post("/api/guidance", BODY, { appCheckToken: token });
      expect(ok.status, `request ${i + 1}`).toBe(200);
    }

    const limited = await server.post("/api/guidance", BODY, { appCheckToken: token });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limited");
    expect(body.message).toContain("coba lagi nanti");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(server.fakes.agent.calls).toHaveLength(10);

    server.clock.advance(60 * 60);
    const afterWindow = await server.post("/api/guidance", BODY, { appCheckToken: token });
    expect(afterWindow.status).toBe(200);
  });

  it("refuses the 11th Guidance session from one session cookie even with new App Check tokens", async () => {
    const first = await freshBrowser();
    const cookie = cookieOf(first);
    for (let i = 1; i < 10; i++) {
      const ok = await server.post("/api/guidance", BODY, {
        appCheckToken: server.appCheckToken(),
        headers: { cookie },
      });
      expect(ok.status, `request ${i + 1}`).toBe(200);
    }

    const limited = await server.post("/api/guidance", BODY, {
      appCheckToken: server.appCheckToken(),
      headers: { cookie },
    });
    expect(limited.status).toBe(429);
    expect(server.fakes.agent.calls).toHaveLength(10);
  });

  it("shows the friendly message on the home page form", async () => {
    const token = server.appCheckToken();
    const submit = () =>
      fetch(new URL("/?index", server.baseUrl), {
        method: "POST",
        body: new URLSearchParams({ complaintText: BODY.complaintText, appCheckToken: token }),
      });
    for (let i = 0; i < 10; i++) expect((await submit()).status).toBe(200);

    const limited = await submit();
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain("coba lagi nanti");
  });
});

describe("per-IP ceiling", () => {
  it("does not block 50 different sessions behind one shared carrier IP", async () => {
    for (let i = 0; i < 50; i++) {
      const response = await freshBrowser();
      expect(response.status, `session ${i + 1}`).toBe(200);
    }
    expect(server.fakes.agent.calls).toHaveLength(50);
  });

  it("refuses requests above the per-IP ceiling, then resets after the hour", async () => {
    server.setLimits({ ipPerHour: 5 });
    for (let i = 0; i < 5; i++) expect((await freshBrowser()).status).toBe(200);

    const limited = await freshBrowser();
    expect(limited.status).toBe(429);
    expect(server.fakes.agent.calls).toHaveLength(5);

    server.clock.advance(60 * 60);
    expect((await freshBrowser()).status).toBe(200);
  });
});

describe("Guidance follow-up answers", () => {
  it("charges a follow-up from a brand-new session as a new Guidance session", async () => {
    const token = server.appCheckToken();
    for (let i = 0; i < 10; i++) {
      const ok = await server.post("/api/guidance", { ...BODY, followUpAnswer: "Ya" }, { appCheckToken: token });
      expect(ok.status, `request ${i + 1}`).toBe(200);
    }

    const limited = await server.post("/api/guidance", BODY, { appCheckToken: token });
    expect(limited.status).toBe(429);
  });
});
