// One demo clip per page: Playwright records the whole page, and the clip keeps only what
// follows `start()`, held on screen until the scene's narration target has passed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { CAPTURES_DIR, sceneTarget } from "./scenes.ts";

/** What the video ticket reads to place each clip: captures/clips.json. */
interface ClipEntry {
  scene: number;
  file: string;
  seconds: number;
  recordedAt: string;
  baseURL: string;
}

const MANIFEST = join(CAPTURES_DIR, "clips.json");

export class Clip {
  // The page's video starts with the page, a moment before this.
  private readonly openedAt = Date.now();
  private startedAt: number | null = null;
  private readonly page: Page;
  private readonly scene: number;
  private readonly slug: string;
  private readonly baseURL: string;

  constructor(page: Page, scene: number, slug: string, baseURL: string) {
    this.page = page;
    this.scene = scene;
    this.slug = slug;
    this.baseURL = baseURL;
  }

  /** The scene's first frame: everything recorded before (loading, setup) is cut. */
  start() {
    this.startedAt = Date.now();
  }

  /** Pauses on the current frame, so the viewer can read it. */
  async hold(seconds: number) {
    await this.page.waitForTimeout(seconds * 1000);
  }

  /** Holds the last frame until the scene is as long as its narration target, then saves the clip. */
  async finish(): Promise<string> {
    if (this.startedAt === null) throw new Error(`Clip ${this.slug} finished without start()`);
    // A second over the target: the encoded clip can end a few frames short of the last hold.
    const target = sceneTarget(this.scene);
    const elapsed = (Date.now() - this.startedAt) / 1000;
    if (elapsed < target + 1) await this.hold(target + 1 - elapsed);

    const video = this.page.video();
    if (!video) throw new Error("Video recording is off; run with playwright.capture.config.ts");
    await this.page.close();
    const raw = await video.path();

    mkdirSync(CAPTURES_DIR, { recursive: true });
    const file = `scene-${this.scene}-${this.slug}.mp4`;
    const trim = ((this.startedAt - this.openedAt) / 1000).toFixed(2);
    // H.264 in MP4 for any video editor; no audio track (the narration is separate).
    execFileSync(
      "ffmpeg",
      [
        ...["-y", "-loglevel", "error", "-ss", trim, "-i", raw],
        ...["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-an"],
        join(CAPTURES_DIR, file),
      ],
      { stdio: "inherit" },
    );
    const seconds = encodedSeconds(join(CAPTURES_DIR, file));
    if (seconds < target) throw new Error(`${file} runs ${seconds} s, under its ${target} s scene target`);
    recordClip({ scene: this.scene, file, seconds, recordedAt: new Date().toISOString(), baseURL: this.baseURL });
    return file;
  }
}

/** The saved clip's length, to a tenth of a second. */
function encodedSeconds(path: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], {
    encoding: "utf8",
  });
  return Math.round(Number(out) * 10) / 10;
}

function recordClip(entry: ClipEntry) {
  const clips: ClipEntry[] = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
  const others = clips.filter((clip) => clip.file !== entry.file);
  const sorted = [...others, entry].sort((a, b) => a.scene - b.scene || a.file.localeCompare(b.file));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
}
