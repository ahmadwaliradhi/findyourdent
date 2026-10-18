import type { GuidanceRequest } from "@findyourdent/contracts";
import { describe, expect, it } from "vitest";
import {
  createScriptedFakeAgentAdapter,
  FAKE_FOLLOW_UP_TRIGGER,
  STUB_FOLLOW_UP_RESPONSE,
  STUB_GUIDANCE_RESPONSE,
} from "../../server/adapters/fakes.ts";

const LOOSE: GuidanceRequest = {
  sessionId: "sess-0001-abcd",
  language: "id",
  complaintText: `Gigi geraham ${FAKE_FOLLOW_UP_TRIGGER}`,
};

describe("scripted fake agent", () => {
  it("asks the follow-up question for a complaint with the trigger word, then gives the Guidance once answered", async () => {
    const agent = createScriptedFakeAgentAdapter();

    expect(await agent.requestGuidance(LOOSE)).toEqual(STUB_FOLLOW_UP_RESPONSE);
    const answered = {
      ...LOOSE,
      followUpQuestion: STUB_FOLLOW_UP_RESPONSE.question,
      followUpAnswer: "Tidak ada nyeri",
    };
    expect(await agent.requestGuidance(answered)).toEqual(STUB_GUIDANCE_RESPONSE);
    expect(agent.calls).toHaveLength(2);
  });

  it("gives the Guidance at once for any other complaint", async () => {
    const agent = createScriptedFakeAgentAdapter();

    expect(await agent.requestGuidance({ ...LOOSE, complaintText: "Gigi ngilu" })).toEqual(STUB_GUIDANCE_RESPONSE);
  });

  it("answers what respondWith queued, even for the trigger word", async () => {
    const agent = createScriptedFakeAgentAdapter();
    agent.respondWith(new Error("agent down"));

    await expect(agent.requestGuidance(LOOSE)).rejects.toThrow("agent down");
  });
});
