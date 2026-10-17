import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAILS, startTestServer, type TestServer } from "../support/harness.ts";

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

function get(pathname: string, cookie = "") {
  return fetch(new URL(pathname, server.baseUrl), { headers: { cookie }, redirect: "manual" });
}

describe("Google sign-in", () => {
  it("turns one Google sign-in into a session cookie, with no verification step", async () => {
    const idToken = await server.emulatorIdToken({ email: "pasien@example.com", provider: "google.com" });

    const response = await server.post("/auth/session", { idToken });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/^__session=.+HttpOnly/i);
  });

  it("refuses any sign-in provider other than Google", async () => {
    const idToken = await server.emulatorIdToken({ email: "pasien@example.com", provider: "password" });

    const response = await server.post("/auth/session", { idToken });

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a forged ID token", async () => {
    const response = await server.post("/auth/session", { idToken: "not-a-token" });

    expect(response.status).toBe(401);
  });

  it("signs out by clearing the session cookie", async () => {
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const response = await fetch(new URL("/auth/signout", server.baseUrl), {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toMatch(/^__session=[^;]*;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });
});

describe("admin allowlist", () => {
  it("sends an anonymous visitor to sign in", async () => {
    const response = await get("/admin");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/signin?redirectTo=%2Fadmin");
  });

  it("lets each allowlisted account in, whatever the email's case", async () => {
    for (const email of ADMIN_EMAILS) {
      const cookie = await server.signInWithGoogle(email.toUpperCase());
      const response = await get("/admin", cookie);
      expect(response.status, email).toBe(200);
      expect((await response.text()).toLowerCase()).toContain(email);
    }
  });

  it("keeps a signed-in account that is not allowlisted out of every admin route", async () => {
    const cookie = await server.signInWithGoogle("pasien@example.com");

    const page = await get("/admin", cookie);
    const data = await get("/admin.data", cookie);
    const nested = await get("/admin/testimonies", cookie);
    const otherCase = await get("/ADMIN", cookie);
    const action = await fetch(new URL("/admin", server.baseUrl), {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams({ intent: "publish" }),
    });

    expect([page.status, data.status, nested.status, otherCase.status, action.status]).toEqual([
      403, 403, 403, 403, 403,
    ]);
  });

  it("refuses a forged session cookie", async () => {
    const response = await get("/admin", "__session=forged");

    expect(response.status).toBe(302);
  });
});
