import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sceneTargetSeconds } from "../../e2e-capture/scenes.ts";

const table = `
## Measured durations

| Scene | Target | Narration | Characters |
| --- | --- | --- | --- |
| 1. Problem | 0:40 | 0:38 | 570 |
| 2. Guidance | 1:05 | 0:51 | 712 |
| 3. Shortlist | 0:35 | 0:25 | 392 |
| Total | 2:20 | 1:54 | 1,674 |
`;

describe("sceneTargetSeconds", () => {
  it("reads each scene's target duration, in seconds, from the narration script", () => {
    expect(sceneTargetSeconds(table)).toEqual({ 1: 40, 2: 65, 3: 35 });
  });

  it("covers all five scenes of the committed script, each at least as long as its narration", () => {
    const script = readFileSync(new URL("../../../../docs/submission/video/narration.md", import.meta.url), "utf8");
    const targets = sceneTargetSeconds(script);
    // From the script's measured-durations table: narration 0:38, 0:51, 0:25, 0:31, 0:31.
    expect(targets[1]).toBeGreaterThanOrEqual(38);
    expect(targets[2]).toBeGreaterThanOrEqual(51);
    expect(targets[3]).toBeGreaterThanOrEqual(25);
    expect(targets[4]).toBeGreaterThanOrEqual(31);
    expect(targets[5]).toBeGreaterThanOrEqual(31);
  });

  it("fails loudly when the table is missing", () => {
    expect(() => sceneTargetSeconds("# Demo video narration")).toThrow(/Measured durations/);
  });
});
