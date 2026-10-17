import type { Guidance } from "@findyourdent/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shareToken } from "../../app/server/share.server.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
import { startTestServer, type TestServer } from "../support/harness.ts";

const GUIDANCE = STUB_GUIDANCE_RESPONSE.guidance as unknown as Guidance;

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

describe("POST /api/guidance-card", () => {
  it("rebuilds the Guidance from its signed token, with no agent call", async () => {
    const response = await server.post("/api/guidance-card", { token: shareToken(GUIDANCE, "test-share-link-secret") });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ guidance: GUIDANCE });
    expect(server.fakes.agent.calls).toHaveLength(0);
  });

  it("refuses a token signed with another secret", async () => {
    const response = await server.post("/api/guidance-card", { token: shareToken(GUIDANCE, "another-secret") });

    expect(response.status).toBe(404);
  });

  it("refuses a body without a token", async () => {
    const response = await server.post("/api/guidance-card", { guidance: GUIDANCE });

    expect(response.status).toBe(400);
  });
});
