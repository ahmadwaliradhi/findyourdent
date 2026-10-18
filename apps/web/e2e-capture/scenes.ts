// Scene lengths for the demo captures, read from the narration script so a clip is never
// shorter than the voice track it sits under.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const NARRATION_PATH = fileURLToPath(new URL("../../../docs/submission/video/narration.md", import.meta.url));

/** Where the clips land, next to the narration audio (issue #111). */
export const CAPTURES_DIR = fileURLToPath(new URL("../../../docs/submission/video/captures/", import.meta.url));

/** Each scene's target duration in seconds, from the "Measured durations" table of the narration script. */
export function sceneTargetSeconds(markdown: string): Record<number, number> {
  const section = markdown.split(/^## Measured durations$/m)[1];
  if (section === undefined) throw new Error('The narration script has no "## Measured durations" table.');
  const targets: Record<number, number> = {};
  // A row such as "| 2. Guidance | 1:00 | 0:51 | 712 |": scene number, then the target as m:ss.
  for (const [, scene, minutes, seconds] of section.matchAll(/^\|\s*(\d+)\.[^|]*\|\s*(\d+):(\d{2})\s*\|/gm)) {
    targets[Number(scene)] = Number(minutes) * 60 + Number(seconds);
  }
  return targets;
}

/** The target duration of one scene in the committed script, in seconds. */
export function sceneTarget(scene: number): number {
  const seconds = sceneTargetSeconds(readFileSync(NARRATION_PATH, "utf8"))[scene];
  if (seconds === undefined) throw new Error(`The narration script has no target for scene ${scene}.`);
  return seconds;
}
