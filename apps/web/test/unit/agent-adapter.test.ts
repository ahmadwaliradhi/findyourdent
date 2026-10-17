import type { GuidanceRequest, ModerationRequest, ShortlistReasonsRequest } from "@findyourdent/contracts";
import { describe, expect, it } from "vitest";
import { createHttpAgentAdapter, createMetadataIdTokenSource } from "../../server/adapters/agent.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";

const REQUEST: GuidanceRequest = { sessionId: "sess-0001-abcd", language: "id", complaintText: "Gigi ngilu" };

interface SeenRequest {
  url: string;
  headers: Headers;
}

/** A fetch that records what it was sent and answers like the agent service. */
function fakeAgent() {
  const seen: SeenRequest[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json(STUB_GUIDANCE_RESPONSE);
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

describe("HTTP agent adapter", () => {
  it("passes the request id on to the agent service so both services log the same id", async () => {
    const agent = fakeAgent();
    const adapter = createHttpAgentAdapter({ baseUrl: "https://agent.example/", fetch: agent.fetch });

    await adapter.requestGuidance(REQUEST, { requestId: "4bf92f3577b34da6a3ce929d0e0e4736" });

    expect(agent.seen).toHaveLength(1);
    expect(agent.seen[0]?.url).toBe("https://agent.example/v1/guidance");
    expect(agent.seen[0]?.headers.get("x-request-id")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});

const REASONS_REQUEST: ShortlistReasonsRequest = {
  sessionId: "sess-0001-abcd",
  language: "id",
  likelyProcedures: ["root_canal_treatment"],
  providers: [
    {
      placeId: "place-klinik-senyum",
      name: "Klinik Senyum",
      providerType: "klinik",
      providerTypeSource: "inferred",
      rank: 1,
      testimonies: { count: 0, verifiedVisitCount: 0 },
    },
  ],
};

describe("HTTP agent adapter for Shortlist reasons", () => {
  it("asks the agent service's reasons endpoint with the same request id and identity token", async () => {
    const agent = fakeAgent();
    const adapter = createHttpAgentAdapter({
      baseUrl: "https://agent.example",
      fetch: agent.fetch,
      idToken: async () => "token-for-fyd-web",
    });

    await adapter.requestShortlistReasons(REASONS_REQUEST, { requestId: "4bf92f3577b34da6a3ce929d0e0e4736" });

    expect(agent.seen[0]?.url).toBe("https://agent.example/v1/shortlist-reasons");
    expect(agent.seen[0]?.headers.get("x-request-id")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(agent.seen[0]?.headers.get("authorization")).toBe("Bearer token-for-fyd-web");
  });

  it("reports the agent's retry state as unavailable, so the Shortlist keeps its templated reasons", async () => {
    const fetch = (async () =>
      Response.json({ error: "model_unavailable" }, { status: 503 })) as typeof globalThis.fetch;
    const adapter = createHttpAgentAdapter({ baseUrl: "https://agent.example", fetch });

    await expect(adapter.requestShortlistReasons(REASONS_REQUEST)).rejects.toMatchObject({
      name: "AgentUnavailableError",
      status: 503,
    });
  });

  it("keeps the agent's error code, so a voice note without speech can ask for a new recording", async () => {
    const fetch = (async () => Response.json({ error: "no_speech" }, { status: 422 })) as typeof globalThis.fetch;
    const adapter = createHttpAgentAdapter({ baseUrl: "https://agent.example", fetch });

    await expect(
      adapter.requestGuidance({
        sessionId: "sess-0001-abcd",
        language: "id",
        audio: { mimeType: "audio/webm", dataBase64: "GkXfow==" },
      }),
    ).rejects.toMatchObject({ name: "AgentUnavailableError", status: 422, code: "no_speech" });
  });
});

describe("HTTP agent adapter on Cloud Run", () => {
  it("proves it is the web service with an identity token, since the agent service refuses anonymous calls", async () => {
    const agent = fakeAgent();
    const adapter = createHttpAgentAdapter({
      baseUrl: "https://agent.example",
      fetch: agent.fetch,
      idToken: async () => "token-for-fyd-web",
    });

    await adapter.requestGuidance(REQUEST);

    expect(agent.seen[0]?.headers.get("authorization")).toBe("Bearer token-for-fyd-web");
  });

  it("calls the agent service without a token when none is configured (local development)", async () => {
    const agent = fakeAgent();
    const adapter = createHttpAgentAdapter({ baseUrl: "http://localhost:8000", fetch: agent.fetch });

    await adapter.requestGuidance(REQUEST);

    expect(agent.seen[0]?.headers.get("authorization")).toBeNull();
  });
});

/** An unsigned JWT that expires at `exp` (seconds); the adapter only reads exp. */
function jwt(exp: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ exp })}.signature`;
}

describe("identity token from the Cloud Run metadata server", () => {
  it("asks for a token for the agent URL and reuses it until shortly before it expires", async () => {
    let nowMs = 1_800_000_000_000;
    const asked: SeenRequest[] = [];
    const metadata = (async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(jwt(nowMs / 1000 + 3600));
    }) as typeof fetch;
    const idToken = createMetadataIdTokenSource({
      audience: "https://fyd-agent-xyz.a.run.app",
      fetch: metadata,
      now: () => nowMs,
    });

    const first = await idToken();
    nowMs += 50 * 60 * 1000;
    expect(await idToken()).toBe(first);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https%3A%2F%2Ffyd-agent-xyz.a.run.app",
    );
    expect(asked[0]?.headers.get("metadata-flavor")).toBe("Google");

    nowMs += 6 * 60 * 1000;
    await idToken();
    expect(asked).toHaveLength(2);
  });
});

const MODERATION_REQUEST: ModerationRequest = {
  subjectType: "testimony",
  language: "id",
  text: "Dokternya sabar dan ruangannya bersih.",
  visitMonth: "2026-09",
  authorFixRound: 0,
};

describe("HTTP agent adapter for Moderation", () => {
  it("posts the Testimony to the agent's Moderation endpoint with the request id and identity token", async () => {
    const agent = fakeAgent();
    const adapter = createHttpAgentAdapter({
      baseUrl: "https://agent.example",
      fetch: agent.fetch,
      idToken: async () => "token-for-fyd-web",
    });

    await adapter.requestModeration(MODERATION_REQUEST, { requestId: "4bf92f3577b34da6a3ce929d0e0e4736" });

    expect(agent.seen[0]?.url).toBe("https://agent.example/v1/moderation");
    expect(agent.seen[0]?.headers.get("x-request-id")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(agent.seen[0]?.headers.get("authorization")).toBe("Bearer token-for-fyd-web");
  });

  it("reports a refused attachment (422 invalid_base64) as unavailable, so the web service never publishes on it", async () => {
    const fetch = (async () =>
      Response.json(
        { detail: [{ type: "invalid_base64", loc: ["body"], msg: "attachment is not base64" }] },
        { status: 422 },
      )) as typeof globalThis.fetch;
    const adapter = createHttpAgentAdapter({ baseUrl: "https://agent.example", fetch });

    await expect(adapter.requestModeration(MODERATION_REQUEST)).rejects.toMatchObject({
      name: "AgentUnavailableError",
      status: 422,
    });
  });
});
