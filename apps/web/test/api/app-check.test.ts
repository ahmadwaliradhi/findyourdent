import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

const COMPLAINT = "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari";

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

function expectNoAdapterCalled() {
  expect(server.fakes.agent.calls).toEqual([]);
  expect(server.fakes.places.calls).toEqual([]);
  expect(server.fakes.gemini.calls).toEqual([]);
}

describe("App Check on paid routes", () => {
  it("refuses POST /api/guidance without an App Check token and calls no adapter", async () => {
    const response = await server.post(
      "/api/guidance",
      { complaintText: COMPLAINT, language: "id" },
      { appCheckToken: null },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "app_check_required" });
    expectNoAdapterCalled();
  });

  it("refuses POST /api/guidance with a forged App Check token", async () => {
    const response = await server.post(
      "/api/guidance",
      { complaintText: COMPLAINT, language: "id" },
      { appCheckToken: "forged.jwt.token" },
    );

    expect(response.status).toBe(401);
    expectNoAdapterCalled();
  });

  it("refuses the home Guidance form without an App Check token and calls no adapter", async () => {
    const response = await fetch(new URL("/?index", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ complaintText: COMPLAINT }),
    });

    expect(response.status).toBe(401);
    expectNoAdapterCalled();
  });

  it("accepts the home Guidance form when the token comes in the form body", async () => {
    const response = await fetch(new URL("/?index", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ complaintText: COMPLAINT, appCheckToken: server.appCheckToken() }),
    });

    expect(response.status).toBe(200);
    expect(server.fakes.agent.calls).toHaveLength(1);
  });
});
