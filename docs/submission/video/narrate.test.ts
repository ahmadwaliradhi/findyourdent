import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseScript, resolveApiKey } from "./narrate.ts";

const sample = `# Narration

Intro text that is not part of any scene.

## Scene 1: Problem (target 0:35)

**On screen:** the landing page.

**Narration:**

> First line of narration,
> continued here.

## Scene 2: Guidance (target 1:05)

**On screen:** the Guidance card.

**Narration:**

> Second scene.

## Measured durations

| Scene | Seconds |
`;

test("parseScript reads each scene's title, target and narration", () => {
  assert.deepEqual(parseScript(sample), [
    {
      number: 1,
      title: "Problem",
      targetSeconds: 35,
      onScreen: "the landing page.",
      narration: "First line of narration, continued here.",
    },
    {
      number: 2,
      title: "Guidance",
      targetSeconds: 65,
      onScreen: "the Guidance card.",
      narration: "Second scene.",
    },
  ]);
});

test("the real script has the five storyboard scenes, timed to 3:20 to 3:40", () => {
  const scenes = parseScript(readFileSync(new URL("narration.md", import.meta.url), "utf8"));
  assert.deepEqual(
    scenes.map((scene) => scene.title),
    ["Problem", "Guidance", "Shortlist", "Posting a Testimony", "Architecture and impact"],
  );
  const total = scenes.reduce((sum, scene) => sum + scene.targetSeconds, 0);
  assert.ok(total >= 200 && total <= 220, `total target ${total}s is outside 200 to 220s`);
  for (const scene of scenes) {
    assert.ok(scene.onScreen, `scene ${scene.number} names no on-screen action`);
    assert.ok(scene.narration, `scene ${scene.number} has no narration`);
  }
});

test("resolveApiKey prefers the environment, then .env.local, and fails without either", () => {
  const dotenv = 'OTHER=1\nELEVENLABS_API_KEY="from-file"\n';
  assert.equal(resolveApiKey({ ELEVENLABS_API_KEY: "from-env" }, dotenv), "from-env");
  assert.equal(resolveApiKey({}, dotenv), "from-file");
  assert.equal(resolveApiKey({}, "export ELEVENLABS_API_KEY=plain\n"), "plain");
  assert.throws(() => resolveApiKey({}, undefined), /ELEVENLABS_API_KEY/);
  assert.throws(() => resolveApiKey({ ELEVENLABS_API_KEY: "" }, "# none\n"), /ELEVENLABS_API_KEY/);
});
