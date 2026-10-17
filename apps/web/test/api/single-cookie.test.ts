import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAILS, startTestServer, type TestServer } from "../support/harness.ts";

const BODY = { complaintText: "Gigi ngilu kalau minum dingin", language: "id" };

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

/**
 * A browser behind Firebase Hosting: Hosting forwards only the `__session` request
 * cookie to Cloud Run and strips every other one, so this jar keeps nothing else.
 */
function hostingBrowser() {
  let session = "";
  return {
    get cookie() {
      return session;
    },
    /** Takes the response's Set-Cookie, failing on any cookie Hosting would drop. */
    store(response: Response) {
      for (const setCookie of response.headers.getSetCookie()) {
        const pair = setCookie.split(";")[0] ?? "";
        expect(pair, "only __session survives Firebase Hosting").toMatch(/^__session=/);
        session = /Max-Age=0/i.test(setCookie) ? "" : pair;
      }
      return response;
    },
  };
}

describe("behind Firebase Hosting, with only the __session cookie", () => {
  it("keeps the Guidance session, the language toggle and the Google sign-in together", async () => {
    const browser = hostingBrowser();
    const guidance = (appCheckToken = server.appCheckToken()) =>
      server
        .post("/api/guidance", BODY, { appCheckToken, headers: { cookie: browser.cookie } })
        .then((response) => browser.store(response));

    // Guidance first: the session id goes into __session.
    expect((await guidance()).status).toBe(200);

    // The English toggle joins it.
    browser.store(
      await fetch(new URL("/language", server.baseUrl), {
        method: "POST",
        headers: { cookie: browser.cookie },
        body: new URLSearchParams({ lang: "en", redirectTo: "/" }),
        redirect: "manual",
      }),
    );

    // Google sign-in joins it too, without dropping the other two.
    const idToken = await server.emulatorIdToken({ email: ADMIN_EMAILS[0] ?? "", provider: "google.com" });
    const signIn = browser.store(
      await server.post("/auth/session", { idToken }, { headers: { cookie: browser.cookie } }),
    );
    expect(signIn.status).toBe(200);

    const admin = await fetch(new URL("/admin", server.baseUrl), {
      headers: { cookie: browser.cookie },
      redirect: "manual",
    });
    expect(admin.status).toBe(200);
    expect(await admin.text()).toMatch(/<html[^>]*lang="en"/);

    // The follow-up turn stays in the same Guidance session.
    expect((await guidance()).status).toBe(200);
    const [turn1, turn2] = server.fakes.agent.calls;
    expect(turn2?.sessionId).toBe(turn1?.sessionId);

    // Signing out keeps the language and the Guidance session.
    browser.store(
      await fetch(new URL("/auth/signout", server.baseUrl), {
        method: "POST",
        headers: { cookie: browser.cookie },
        redirect: "manual",
      }),
    );
    const signedOut = await fetch(new URL("/admin", server.baseUrl), {
      headers: { cookie: browser.cookie },
      redirect: "manual",
    });
    expect(signedOut.status).toBe(302);
    const home = await fetch(new URL("/", server.baseUrl), { headers: { cookie: browser.cookie } });
    expect(await home.text()).toMatch(/<html[^>]*lang="en"/);
    expect((await guidance()).status).toBe(200);
    expect(server.fakes.agent.calls[2]?.sessionId).toBe(turn1?.sessionId);
  });

  it("enforces the per-session Guidance limit from __session alone", async () => {
    server.setLimits({ guidanceSessionsPerHour: 2 });
    const browser = hostingBrowser();
    const guidance = () =>
      server
        .post("/api/guidance", BODY, { appCheckToken: server.appCheckToken(), headers: { cookie: browser.cookie } })
        .then((response) => browser.store(response));

    expect((await guidance()).status).toBe(200);
    expect((await guidance()).status).toBe(200);
    // A new App Check token each time, so only the session counter can refuse this.
    expect((await guidance()).status).toBe(429);
    expect(server.logs.some((line) => line.includes('"scope":"session"'))).toBe(true);
  });

  it("replaces a Guidance session id older than 12 hours even while the cookie lives on", async () => {
    // What a browser holds a day after toggling to English: the cookie lasts a year for
    // the language, but the session id in it must not (spec 01: opaque, short-lived).
    const state = { sid: "sess-old-0001-abcd", sidAt: Date.now() - 24 * 60 * 60 * 1000, lang: "en" };
    const cookie = `__session=${encodeURIComponent(Buffer.from(JSON.stringify(state)).toString("base64"))}`;

    const response = await server.post("/api/guidance", BODY, { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(server.fakes.agent.calls[0]?.sessionId).not.toBe("sess-old-0001-abcd");
    const renewed = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    const page = await fetch(new URL("/", server.baseUrl), { headers: { cookie: renewed } });
    expect(await page.text()).toMatch(/<html[^>]*lang="en"/);
  });
});
