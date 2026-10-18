// Demo video narration (issue #110): reads the scenes in narration.md and
// turns each scene's narration into one MP3 through the ElevenLabs API.
// Usage: node docs/submission/video/narrate.ts [scene numbers...]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Scene {
  number: number;
  title: string;
  targetSeconds: number;
  onScreen: string;
  narration: string;
}

const SCENE_HEADING = /^## Scene (\d+): (.+) \(target (\d+):(\d{2})\)$/;

/** Reads every `## Scene N: Title (target M:SS)` section of the narration script. */
export function parseScript(markdown: string): Scene[] {
  const scenes: Scene[] = [];
  let current: { scene: Scene; lines: string[] } | undefined;
  const finish = () => {
    if (current) {
      current.scene.narration = current.lines.join(" ").trim();
      scenes.push(current.scene);
    }
    current = undefined;
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      finish();
      const match = SCENE_HEADING.exec(line);
      if (match) {
        current = {
          scene: {
            number: Number(match[1]),
            title: match[2] ?? "",
            targetSeconds: Number(match[3]) * 60 + Number(match[4]),
            onScreen: "",
            narration: "",
          },
          lines: [],
        };
      }
    } else if (current && line.startsWith("**On screen:**")) {
      current.scene.onScreen = line.slice("**On screen:**".length).trim();
    } else if (current && line.startsWith(">")) {
      current.lines.push(line.slice(1).trim());
    }
  }
  finish();
  return scenes;
}

const KEY_NAME = "ELEVENLABS_API_KEY";
const KEY_LINE = new RegExp(`^\\s*(?:export\\s+)?${KEY_NAME}\\s*=\\s*(.*)$`);

/** The ElevenLabs key from the environment, else from the gitignored `.env.local`. */
export function resolveApiKey(
  env: Record<string, string | undefined>,
  dotenvText: string | undefined,
): string {
  if (env[KEY_NAME]) return env[KEY_NAME];
  for (const line of dotenvText?.split("\n") ?? []) {
    const match = KEY_LINE.exec(line);
    const value = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value) return value;
  }
  throw new Error(`${KEY_NAME} is not set in the environment or in .env.local`);
}

const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww"; // River: premade, neutral, American English
const MODEL_ID = "eleven_multilingual_v2";

async function main(sceneArgs: string[]) {
  const here = new URL(".", import.meta.url);
  const dotenvUrl = new URL("../../../.env.local", here);
  const apiKey = resolveApiKey(
    process.env,
    existsSync(dotenvUrl) ? readFileSync(dotenvUrl, "utf8") : undefined,
  );
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const scenes = parseScript(readFileSync(new URL("narration.md", here), "utf8"));
  const wanted = sceneArgs.map(Number);
  const selected = wanted.length
    ? scenes.filter((scene) => wanted.includes(scene.number))
    : scenes;
  if (selected.length !== (wanted.length || scenes.length)) {
    throw new Error(`Unknown scene in ${sceneArgs.join(" ")}`);
  }

  const audioDir = new URL("audio/", here);
  mkdirSync(audioDir, { recursive: true });
  for (const scene of selected) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text: scene.narration, model_id: MODEL_ID }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `ElevenLabs answered ${response.status} for scene ${scene.number}: ${await response.text()}`,
      );
    }
    const file = new URL(`scene-${scene.number}.mp3`, audioDir);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    const seconds = Number(
      execFileSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fileURLToPath(file),
      ]).toString(),
    );
    console.log(
      `| ${scene.number}. ${scene.title} | ${formatSeconds(scene.targetSeconds)} | ${formatSeconds(seconds)} | ${scene.narration.length} |`,
    );
  }
}

function formatSeconds(total: number): string {
  const rounded = Math.round(total);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
