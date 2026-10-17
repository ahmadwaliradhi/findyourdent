import { validateGuidanceRequest, validateGuidanceResponse } from "@findyourdent/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
import { startTestServer, type TestServer } from "../support/harness.ts";

const COMPLAINT = "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari, makin sakit kalau malam";

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

describe("POST /api/guidance", () => {
  it("returns the agent's Guidance response and sends the agent a valid GuidanceRequest", async () => {
    const response = await server.post("/api/guidance", { complaintText: COMPLAINT, language: "id" });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(validateGuidanceResponse(body), JSON.stringify(validateGuidanceResponse.errors)).toBe(true);
    expect(body).toEqual(STUB_GUIDANCE_RESPONSE);

    expect(server.fakes.agent.calls).toHaveLength(1);
    const sent = server.fakes.agent.calls[0];
    expect(validateGuidanceRequest(sent), JSON.stringify(validateGuidanceRequest.errors)).toBe(true);
    expect(sent).toMatchObject({ complaintText: COMPLAINT, language: "id" });
    expect(response.headers.get("set-cookie")).toMatch(/^__session=/);

    // Complaint text is processed in memory only: nothing stored, nothing logged.
    expect(await server.firestore.listCollections()).toEqual([]);
    expect(server.logs.join("\n")).not.toContain("nyut-nyutan");
    expect(server.fakes.places.calls).toEqual([]);
    expect(server.fakes.gemini.calls).toEqual([]);
  });

  it("keeps one opaque session id across the follow-up turn", async () => {
    server.fakes.agent.respondWith({
      kind: "followUp",
      question: "Apakah gusinya bengkak?",
      quickReplies: ["Ya", "Tidak"],
    });
    const first = await server.post("/api/guidance", { complaintText: COMPLAINT, language: "id" });
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";

    server.fakes.agent.respondWith(STUB_GUIDANCE_RESPONSE);
    const second = await server.post(
      "/api/guidance",
      { complaintText: COMPLAINT, language: "id", followUpAnswer: "Tidak" },
      { headers: { cookie } },
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("set-cookie")).toBeNull();

    const [turn1, turn2] = server.fakes.agent.calls;
    expect(turn2?.sessionId).toBe(turn1?.sessionId);
    expect(turn2?.followUpAnswer).toBe("Tidak");
  });

  it("refuses an invalid request without calling the agent", async () => {
    const response = await server.post("/api/guidance", { complaintText: "", language: "fr" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(server.fakes.agent.calls).toEqual([]);
  });

  it("does not pass on an agent response that breaks the contract", async () => {
    server.fakes.agent.respondWith({ kind: "guidance", guidance: { urgencyTier: "besok" } });

    const response = await server.post("/api/guidance", { complaintText: COMPLAINT, language: "en" });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "invalid_agent_response" });
  });
});

describe("language detection", () => {
  it("serves Indonesian to an English-locale browser until the toggle is used", async () => {
    const first = await fetch(new URL("/", server.baseUrl), { headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(await first.text()).toMatch(/<html[^>]*lang="id"/);

    const toggle = await fetch(new URL("/language", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ lang: "en", redirectTo: "/" }),
      redirect: "manual",
    });
    const cookie = toggle.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^__session=/);

    const toggled = await fetch(new URL("/", server.baseUrl), {
      headers: { "accept-language": "en-US,en;q=0.9", cookie },
    });
    expect(await toggled.text()).toMatch(/<html[^>]*lang="en"/);
  });
});

describe("Emergency Escalation card", () => {
  it("renders the red IGD card with a Google Maps search for the nearest IGD", async () => {
    server.fakes.agent.respondWith({
      kind: "emergency",
      reason: "Bengkak di wajah atau leher disertai demam bisa berarti infeksi yang menyebar.",
      redFlags: ["facial_or_neck_swelling", "fever"],
      hospitalSearch: { providerType: "hospital", requiresEmergencyDepartment: true },
    });

    const response = await fetch(new URL("/?index", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ complaintText: "Pipi bengkak dan demam" }),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-kind="emergency"');
    expect(html).toContain("Ke IGD sekarang");
    expect(html).toContain("infeksi yang menyebar");
    // Plain Maps URL, no Places call, and the complaint never goes into it.
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=IGD%20rumah%20sakit%20terdekat"');
    expect(html).not.toMatch(/maps\/search[^"]*bengkak/i);
    expect(server.fakes.places.calls).toEqual([]);
  });
});

describe("Shareable Guidance link", () => {
  async function shareLink(complaintText: string): Promise<{ html: string; link: string }> {
    const response = await fetch(new URL("/?index", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ complaintText }),
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    const link = html.match(/href="(\/panduan\/[^"]+)"/)?.[1];
    if (!link) throw new Error("no share link on the Guidance card");
    return { html, link };
  }

  it("is built from the Guidance alone, so the complaint never reaches it", async () => {
    const first = await shareLink(COMPLAINT);
    const second = await shareLink("Gigi belakang ngilu banget kalau minum es, sudah seminggu");

    // Same Guidance, different complaints: the same link.
    expect(second.link).toBe(first.link);
    expect(first.html).toContain(`https://wa.me/?text=${encodeURIComponent(`${server.baseUrl}${first.link}`)}`);
  });

  it("opens a read-only Guidance card that search engines do not index", async () => {
    const { link } = await shareLink(COMPLAINT);

    const shared = await fetch(new URL(link, server.baseUrl));

    expect(shared.status).toBe(200);
    const html = await shared.text();
    expect(html).toContain('data-kind="guidance"');
    expect(html).toContain(STUB_GUIDANCE_RESPONSE.guidance.disclaimer);
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
    expect(html).not.toContain("nyut-nyutan");
    expect(server.fakes.agent.calls).toHaveLength(1);
  });

  it("refuses a link whose Guidance was altered", async () => {
    const { link } = await shareLink(COMPLAINT);
    const tampered = `${link.slice(0, 20)}${link[20] === "A" ? "B" : "A"}${link.slice(21)}`;

    const shared = await fetch(new URL(tampered, server.baseUrl));

    expect(shared.status).toBe(404);
  });
});
