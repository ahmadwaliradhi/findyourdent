import { validateGuidanceRequest } from "@findyourdent/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
import { startTestServer, type TestServer } from "../support/harness.ts";

const VOICE_NOTE = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new TextEncoder().encode("fake opus voice note")]);
const HEARD = "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari";

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

/** The home form as the record button submits it: the voice note as a file, no complaint text. */
function recorded(audio: Blob = new Blob([VOICE_NOTE], { type: "audio/webm;codecs=opus" })): FormData {
  const form = new FormData();
  form.set("audio", audio, "voice-note");
  form.set("appCheckToken", server.appCheckToken());
  return form;
}

function postHome(body: FormData): Promise<Response> {
  return fetch(new URL("/?index", server.baseUrl), { method: "POST", body });
}

describe("Voice note from the home form", () => {
  it("forwards the voice note to the agent and shows what was understood, ready to correct", async () => {
    server.fakes.agent.respondWith({ ...STUB_GUIDANCE_RESPONSE, transcript: HEARD });

    const response = await postHome(recorded());

    expect(response.status).toBe(200);
    const [sent] = server.fakes.agent.calls;
    expect(validateGuidanceRequest(sent), JSON.stringify(validateGuidanceRequest.errors)).toBe(true);
    expect(sent?.audio).toEqual({ mimeType: "audio/webm", dataBase64: Buffer.from(VOICE_NOTE).toString("base64") });
    expect(sent?.complaintText).toBeUndefined();

    const html = await response.text();
    expect(html).toContain("Yang kami pahami dari pesan suara Anda");
    // The transcript fills the complaint box, so a misheard word can be fixed and sent as text.
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="complaintText"[^>]*>${HEARD}</textarea>`));
    expect(html).toContain('data-kind="guidance"');

    // Audio is never stored or logged.
    const logs = server.logs.join("\n");
    expect(logs).not.toContain(Buffer.from(VOICE_NOTE).toString("base64"));
    expect(logs).not.toContain("nyut-nyutan");
    const collections = await server.firestore.listCollections();
    expect(collections.map((c) => c.id).sort()).toEqual(["counters", "rateLimits"]);
  });

  it("refuses a voice note longer than the contract allows without calling the agent", async () => {
    const tooLong = new Blob([new Uint8Array(2_200_000)], { type: "audio/webm" });

    const response = await postHome(recorded(tooLong));

    expect(response.status).toBe(413);
    expect(await response.text()).toContain("Pesan suara terlalu panjang");
    expect(server.fakes.agent.calls).toEqual([]);
  });

  it("refuses a recording format Gemini is not sent", async () => {
    const response = await postHome(recorded(new Blob([VOICE_NOTE], { type: "video/x-msvideo" })));

    expect(response.status).toBe(400);
    expect(server.fakes.agent.calls).toEqual([]);
  });

  it("asks the Patient to record again when the agent heard no speech", async () => {
    server.fakes.agent.respondWith(new AgentUnavailableError("agent responded 422", 422, "no_speech"));

    const response = await postHome(recorded());

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Suara Anda tidak terdengar");
  });

  it("prefers typed text when the form carries both", async () => {
    const form = recorded();
    form.set("complaintText", "Gigi depan ngilu");

    await postHome(form);

    expect(server.fakes.agent.calls[0]).toMatchObject({ complaintText: "Gigi depan ngilu" });
    expect(server.fakes.agent.calls[0]?.audio).toBeUndefined();
  });
});
