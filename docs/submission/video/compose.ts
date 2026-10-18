// Demo video composition (issue #24): lays the screen captures (#111) and the
// narration (#110) out on the five-scene storyboard, adds titles and English
// captions, and writes one 1920 × 1080 MP4. Cards and captions are rendered
// as PNGs in Chromium, because Homebrew's ffmpeg has no drawtext or subtitles.
// Usage: node docs/submission/video/compose.ts

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseScript } from "./narrate.ts";

export type Shot =
  | { kind: "still"; card: string; seconds: number }
  | { kind: "clip"; clip: string; from: number; to: number; speed?: number; panel: string };

export type LaidShot = Shot & { start: number; seconds: number; hold: number };

export interface Caption {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z])/;

/** Splits narration into caption lines: one per sentence, long sentences cut at commas. */
export function splitCaptions(text: string, maxLength: number): string[] {
  return text.split(SENTENCE_END).flatMap((sentence) => splitLong(sentence.trim(), maxLength));
}

function splitLong(sentence: string, maxLength: number): string[] {
  if (sentence.length <= maxLength) return [sentence];
  const cut = lastBreak(sentence, maxLength, /[,:;] /g) ?? lastBreak(sentence, maxLength, / /g);
  if (cut === undefined) return [sentence];
  return [sentence.slice(0, cut).trim(), ...splitLong(sentence.slice(cut).trim(), maxLength)];
}

/** The end of the last `pattern` match that keeps the first part within `maxLength`. */
function lastBreak(sentence: string, maxLength: number, pattern: RegExp): number | undefined {
  let best: number | undefined;
  for (const match of sentence.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (end - 1 <= maxLength) best = end;
  }
  return best;
}

/** Midpoints of the pauses that ffmpeg's silencedetect filter reports on stderr. */
export function parsePauses(stderr: string): number[] {
  const pauses: number[] = [];
  let start: number | undefined;
  for (const line of stderr.split("\n")) {
    const opened = /silence_start: ([\d.]+)/.exec(line);
    const closed = /silence_end: ([\d.]+)/.exec(line);
    if (opened) start = Number(opened[1]);
    if (closed && start !== undefined) {
      pauses.push(round((start + Number(closed[1])) / 2));
      start = undefined;
    }
  }
  return pauses;
}

const SNAP_SECONDS = 1.2;

/** Times each caption by its share of the characters, then moves each cut to the nearest pause. */
export function timeCaptions(chunks: string[], pauses: number[], duration: number): Caption[] {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let spoken = 0;
  let start = 0;
  return chunks.map((text, index) => {
    spoken += text.length;
    let end = duration;
    if (index < chunks.length - 1) {
      const estimate = (spoken / total) * duration;
      const nearest = pauses
        .filter((pause) => pause > start && Math.abs(pause - estimate) <= SNAP_SECONDS)
        .sort((a, b) => Math.abs(a - estimate) - Math.abs(b - estimate))[0];
      end = round(nearest ?? estimate);
    }
    const caption = { text, start, end };
    start = end;
    return caption;
  });
}

/** Places shots end to end; the last one holds (or a still lasts) until the scene ends. */
export function layoutShots(shots: Shot[], sceneSeconds: number): LaidShot[] {
  let start = 0;
  const laid = shots.map((shot) => {
    const seconds =
      shot.kind === "still" ? shot.seconds : round((shot.to - shot.from) / (shot.speed ?? 1));
    const placed = { ...shot, start, seconds, hold: 0 };
    start = round(start + seconds);
    return placed;
  });
  const last = laid.at(-1);
  if (last && start < sceneSeconds) {
    const extra = round(sceneSeconds - start);
    if (last.kind === "clip") last.hold = extra;
    last.seconds = round(last.seconds + extra);
  }
  return laid;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Storyboard: what is on screen in each scene. Clip times are seconds into the
// #111 captures; they were read off one-frame-per-second contact sheets.

interface Panel {
  id: string;
  indonesian: string;
  english: string;
  note?: string;
}

interface StoryScene {
  id: string;
  /** Narration scene number in narration.md; none for the opening and closing cards. */
  narration?: number;
  label?: string;
  seconds?: number;
  shots: Shot[];
}

const PANELS: Panel[] = [
  { id: "landing", indonesian: "Testimoni terbaru", english: "Patient Testimonies that FindYourDent owns", note: "findyourdent.com, live" },
  { id: "guidance", indonesian: "Lihat panduan", english: "Guidance from Gemini on Vertex AI: urgency, likely problem, visits, cost, BPJS" },
  { id: "emergency", indonesian: "Ke IGD sekarang", english: "A red-flag check runs before Gemini and sends the Patient to the emergency department" },
  { id: "shortlist", indonesian: "Dokter gigi terdekat", english: "Shortlist: up to five Providers, ranked by fit, Testimonies, price and distance, never by payment" },
  { id: "provider", indonesian: "Lihat ulasan Google", english: "Testimonies first; Google reviews load only on tap" },
  { id: "testimony", indonesian: "Ceritakan pengalamanmu", english: "Posting a Testimony", note: "Demo account “Demo FindYourDent”; the demo Testimony was deleted after recording" },
  { id: "fix", indonesian: "Sedikit perbaikan sebelum terkirim", english: "Gemini Moderation marks the exact sentence to fix before it publishes", note: "Demo account “Demo FindYourDent”; the demo Testimony was deleted after recording" },
  { id: "published", indonesian: "Testimoni Anda sudah terbit", english: "Published after Moderation", note: "Demo account “Demo FindYourDent”; the demo Testimony was deleted after recording" },
  { id: "proven", indonesian: "Kunjungan terbukti", english: "Proof of Visit is checked, then deleted", note: "A real Patient’s Testimony on findyourdent.com" },
  { id: "impact", indonesian: "Dampak FindYourDent", english: "Live counter: Testimonies, Kunjungan terbukti and Guidance sessions" },
];

const CAPTURES = "captures/";

export const STORYBOARD: StoryScene[] = [
  { id: "intro", seconds: 5, shots: [{ kind: "still", card: "intro", seconds: 5 }] },
  {
    id: "scene-1",
    narration: 1,
    label: "1 · Problem",
    shots: [
      { kind: "still", card: "figures", seconds: 21 },
      { kind: "clip", clip: "scene-1-landing.mp4", from: 0, to: 18, panel: "landing" },
    ],
  },
  {
    id: "scene-2",
    narration: 2,
    label: "2 · Guidance",
    shots: [
      { kind: "clip", clip: "scene-2-guidance.mp4", from: 0, to: 10, panel: "guidance" },
      { kind: "clip", clip: "scene-2-guidance.mp4", from: 10, to: 25, speed: 3, panel: "guidance" },
      { kind: "clip", clip: "scene-2-guidance.mp4", from: 25, to: 36, panel: "guidance" },
      { kind: "clip", clip: "scene-2-guidance.mp4", from: 40, to: 47, panel: "guidance" },
      { kind: "clip", clip: "scene-2-guidance.mp4", from: 47, to: 60.4, panel: "emergency" },
    ],
  },
  {
    id: "scene-3",
    narration: 3,
    label: "3 · Shortlist",
    shots: [
      { kind: "clip", clip: "scene-3-shortlist.mp4", from: 0, to: 6, speed: 2, panel: "shortlist" },
      { kind: "clip", clip: "scene-3-shortlist.mp4", from: 6, to: 26, speed: 4 / 3, panel: "shortlist" },
      { kind: "clip", clip: "scene-3-shortlist.mp4", from: 29.5, to: 40, panel: "provider" },
    ],
  },
  {
    id: "scene-4",
    narration: 4,
    label: "4 · Posting a Testimony",
    shots: [
      { kind: "clip", clip: "scene-4-testimony.mp4", from: 0, to: 10, speed: 1.5, panel: "testimony" },
      { kind: "clip", clip: "scene-4-testimony.mp4", from: 10, to: 20, panel: "fix" },
      { kind: "clip", clip: "scene-4-testimony.mp4", from: 20, to: 40, speed: 4, panel: "fix" },
      { kind: "clip", clip: "scene-4-testimony.mp4", from: 42, to: 54, speed: 2, panel: "published" },
      { kind: "clip", clip: "scene-4-proven.mp4", from: 2, to: 10, panel: "proven" },
    ],
  },
  {
    id: "scene-5",
    narration: 5,
    label: "5 · Architecture and impact",
    shots: [
      { kind: "still", card: "architecture", seconds: 18 },
      { kind: "clip", clip: "scene-5-impact.mp4", from: 1, to: 11, panel: "impact" },
      { kind: "still", card: "roadmap", seconds: 4 },
    ],
  },
  { id: "outro", seconds: 6, shots: [{ kind: "still", card: "outro", seconds: 6 }] },
];

/** Silence before the narration starts and after it ends, in each scene. */
const LEAD_SECONDS = 0.8;
const TAIL_SECONDS = 1.5;
const CAPTION_MAX = 110;
const FPS = 25;
const PHONE = { x: 300, y: 28, width: 406, height: 880 };
/** The #111 clips are 720 × 1560, but the page only fills their top-left 360 × 780. */
const CAPTURE_CONTENT = "crop=360:780:0:0";

// ---------------------------------------------------------------------------
// Rendering

const here = new URL(".", import.meta.url);
const path = (relative: string) => fileURLToPath(new URL(relative, here));

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
}

function probeSeconds(file: string): number {
  return Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
      .toString()
      .trim(),
  );
}

function pausesIn(audio: string): number[] {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", audio, "-af", "silencedetect=n=-35dB:d=0.3", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  return parsePauses(result.stderr);
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function dataUrl(file: string, type: string): string {
  return `data:${type};base64,${readFileSync(file).toString("base64")}`;
}

function page(body: string, transparent = false): string {
  const font = dataUrl(path("../../design/design-system/fonts/Figtree-Variable.woff2"), "font/woff2");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Figtree; src: url(${font}) format("woff2"); font-weight: 300 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body { font-family: Figtree, sans-serif; color: #12262b; background: ${transparent ? "transparent" : "#f7f5f0"}; }
.brand { color: #0b6e6a; }
.chip { display: inline-block; padding: 10px 22px; border-radius: 999px; background: #dcefec; color: #084a47; font-size: 28px; font-weight: 650; }
.muted { color: #4b5c60; }
.cite { font-size: 22px; color: #4b5c60; }
</style></head><body>${body}</body></html>`;
}

function panelHtml(scene: StoryScene, panel: Panel): string {
  return page(`
<div style="position:absolute;left:${PHONE.x - 14}px;top:${PHONE.y - 14}px;width:${PHONE.width + 28}px;height:${PHONE.height + 28}px;border-radius:44px;background:#12262b"></div>
<div style="position:absolute;left:880px;top:150px;width:900px">
  <div class="chip">${escapeHtml(scene.label ?? "")}</div>
  <div style="margin-top:48px;font-size:76px;line-height:84px;font-weight:750;letter-spacing:-0.02em" class="brand">${escapeHtml(panel.indonesian)}</div>
  <div style="margin-top:28px;font-size:38px;line-height:50px;font-weight:500" class="muted">${escapeHtml(panel.english)}</div>
  ${panel.note ? `<div style="margin-top:40px;font-size:26px;line-height:34px" class="muted">${escapeHtml(panel.note)}</div>` : ""}
</div>`);
}

function cardHtml(card: string): string {
  switch (card) {
    case "intro":
      return page(`
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
  <div style="font-size:120px;font-weight:800;letter-spacing:-0.03em" class="brand">FindYourDent</div>
  <div style="margin-top:36px;font-size:56px;font-weight:700">Sakit gigi? Pahami dulu sebelum ke dokter gigi.</div>
  <div style="margin-top:20px;font-size:36px" class="muted">Toothache? Understand it before you see a dentist.</div>
  <div style="margin-top:56px" class="chip">AI Builder Cup 2026</div>
</div>`);
    case "figures": {
      const figure = (value: string, indonesian: string, english: string, cite: string) => `
<div style="flex:1;padding:44px 40px;border-radius:28px;background:#ffffff;border:2px solid #d8d3c6">
  <div style="font-size:112px;font-weight:800;letter-spacing:-0.03em" class="brand">${value}</div>
  <div style="margin-top:20px;font-size:34px;line-height:42px;font-weight:650">${indonesian}</div>
  <div style="margin-top:14px;font-size:27px;line-height:35px" class="muted">${english}</div>
  <div style="margin-top:24px" class="cite">${cite}</div>
</div>`;
      return page(`
<div style="position:absolute;left:100px;right:100px;top:90px">
  <div class="chip">1 · Problem</div>
  <div style="margin-top:28px;font-size:60px;font-weight:750;letter-spacing:-0.02em">Survei Kesehatan Indonesia 2023</div>
  <div style="margin-top:48px;display:flex;gap:40px">
    ${figure("56,9%", "penduduk usia 3 tahun ke atas punya masalah gigi dan mulut dalam setahun terakhir", "of Indonesians aged 3 and over had a dental or oral problem in the past year", "SKI 2023 Dalam Angka, Tabel 9.5")}
    ${figure("11,2%", "dari mereka ditangani tenaga kesehatan gigi", "of them were treated by dental health workers", "BKPK SKI 2023 factsheet kesehatan gigi dan mulut")}
    ${figure("57,0%", "yang tidak ditangani tenaga kesehatan gigi merasa tidak perlu", "of people not treated by a dental health worker felt no need", "SKI 2023 Dalam Angka, Tabel 9.7")}
  </div>
</div>`);
    }
    case "architecture":
      return page(`
<div style="position:absolute;left:0;right:0;top:20px;text-align:center">
  <div class="chip">5 · Architecture and impact</div>
</div>
<img src="${dataUrl(path(`${CAPTURES}architecture.png`), "image/png")}" style="position:absolute;left:50%;top:90px;height:830px;transform:translateX(-50%);border-radius:20px;background:#ffffff">`);
    case "roadmap":
      return page(`
<div style="position:absolute;left:160px;right:160px;top:170px">
  <div class="chip">5 · Architecture and impact</div>
  <div style="margin-top:40px;font-size:84px;font-weight:800;letter-spacing:-0.02em" class="brand">Berikutnya</div>
  <div style="margin-top:12px;font-size:40px" class="muted">Next on the roadmap</div>
  <div style="margin-top:56px;font-size:52px;line-height:64px;font-weight:700">Penyedia mengklaim halamannya dan menerbitkan harganya sendiri</div>
  <div style="margin-top:16px;font-size:36px" class="muted">Providers claim their pages and publish their own prices</div>
</div>`);
    case "outro":
      return page(`
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
  <div style="font-size:110px;font-weight:800;letter-spacing:-0.03em" class="brand">findyourdent.com</div>
  <div style="margin-top:36px;font-size:40px" class="muted">Gemini on Vertex AI · Google ADK · Cloud Run · Firestore · Firebase Hosting</div>
  <div style="margin-top:72px;font-size:30px" class="muted">Voice: ElevenLabs · AI Builder Cup 2026</div>
</div>`);
    default:
      throw new Error(`Unknown card ${card}`);
  }
}

function captionHtml(text: string): string {
  return page(
    `<div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center">
  <div style="max-width:1560px;padding:16px 34px;border-radius:18px;background:rgba(18,38,43,0.88);color:#ffffff;font-size:36px;line-height:46px;font-weight:550;text-align:center">${escapeHtml(text)}</div>
</div>`,
    true,
  );
}

async function renderPngs(jobs: { html: string; file: string; transparent?: boolean }[]) {
  const require = createRequire(new URL("../../../apps/web/package.json", here));
  const { chromium } = require("@playwright/test") as typeof import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    for (const job of jobs) {
      await tab.setContent(job.html);
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: job.file, omitBackground: job.transparent ?? false });
    }
  } finally {
    await browser.close();
  }
}

function encodeShot(shot: LaidShot, background: string, out: string) {
  const video = ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an"];
  if (shot.kind === "still") {
    ffmpeg(["-loop", "1", "-framerate", String(FPS), "-t", String(shot.seconds), "-i", background, ...video, out]);
    return;
  }
  const speed = shot.speed ?? 1;
  const phone =
    `[0:v]setpts=(PTS-STARTPTS)/${speed},fps=${FPS},${CAPTURE_CONTENT},scale=${PHONE.width}:${PHONE.height}:flags=lanczos` +
    `,tpad=stop_mode=clone:stop_duration=${shot.hold + 1}[phone]`;
  ffmpeg([
    "-ss", String(shot.from), "-t", String(shot.to - shot.from), "-i", path(`${CAPTURES}${shot.clip}`),
    "-loop", "1", "-framerate", String(FPS), "-i", background,
    "-filter_complex", `${phone};[1:v][phone]overlay=${PHONE.x}:${PHONE.y}:shortest=0,format=yuv420p[v]`,
    "-map", "[v]", "-t", String(shot.seconds), ...video, out,
  ]);
}

async function main() {
  const build = path("build/");
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  const narration = parseScript(readFileSync(path("narration.md"), "utf8"));

  // Plan every scene first, so all PNGs render in one browser session.
  const plans = STORYBOARD.map((scene) => {
    const audio = scene.narration ? path(`audio/scene-${scene.narration}.mp3`) : undefined;
    const spoken = audio ? probeSeconds(audio) : 0;
    const wanted = scene.seconds ?? LEAD_SECONDS + spoken + TAIL_SECONDS;
    const shots = layoutShots(scene.shots, wanted);
    const seconds = round(shots.reduce((sum, shot) => sum + shot.seconds, 0));
    const text = narration.find((entry) => entry.number === scene.narration)?.narration;
    const captions =
      audio && text
        ? timeCaptions(splitCaptions(text, CAPTION_MAX), pausesIn(audio), spoken).map((caption) => ({
            ...caption,
            start: round(caption.start + LEAD_SECONDS),
            end: round(caption.end + LEAD_SECONDS),
          }))
        : [];
    return { scene, audio, shots, seconds, captions };
  });

  const pngs: { html: string; file: string; transparent?: boolean }[] = [];
  for (const { scene, shots, captions } of plans) {
    shots.forEach((shot, index) => {
      const html =
        shot.kind === "still"
          ? cardHtml(shot.card)
          : panelHtml(scene, PANELS.find((panel) => panel.id === shot.panel) ?? missing(shot.panel));
      pngs.push({ html, file: `${build}${scene.id}-shot-${index}.png` });
    });
    captions.forEach((caption, index) => {
      pngs.push({ html: captionHtml(caption.text), file: `${build}${scene.id}-caption-${index}.png`, transparent: true });
    });
  }
  await renderPngs(pngs);

  const sceneFiles: string[] = [];
  for (const { scene, audio, shots, seconds, captions } of plans) {
    const shotFiles = shots.map((shot, index) => {
      const out = `${build}${scene.id}-shot-${index}.mp4`;
      encodeShot(shot, `${build}${scene.id}-shot-${index}.png`, out);
      return out;
    });
    const list = `${build}${scene.id}-shots.txt`;
    writeFileSync(list, shotFiles.map((file) => `file '${file}'`).join("\n"));

    const inputs = ["-f", "concat", "-safe", "0", "-i", list];
    inputs.push(...(audio ? ["-i", audio] : ["-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=44100:cl=stereo"]));
    captions.forEach((_, index) => inputs.push("-i", `${build}${scene.id}-caption-${index}.png`));
    let chain = "[0:v]null[v0]";
    captions.forEach((caption, index) => {
      chain += `;[v${index}][${index + 2}:v]overlay=0:0:enable='between(t,${caption.start},${caption.end - 0.04})'[v${index + 1}]`;
    });
    const fadeOut = round(seconds - 0.4);
    chain += `;[v${captions.length}]fade=t=in:d=0.4:color=0xf7f5f0,fade=t=out:st=${fadeOut}:d=0.4:color=0xf7f5f0,format=yuv420p[v]`;
    const delay = Math.round(LEAD_SECONDS * 1000);
    chain += audio
      ? `;[1:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delay}|${delay},apad[a]`
      : ";[1:a]anull[a]";
    const out = `${build}${scene.id}.mp4`;
    ffmpeg([
      ...inputs, "-filter_complex", chain, "-map", "[v]", "-map", "[a]", "-t", String(seconds),
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-r", String(FPS),
      "-c:a", "pcm_s16le", "-ar", "44100", out.replace(/\.mp4$/, ".mov"),
    ]);
    sceneFiles.push(out.replace(/\.mp4$/, ".mov"));
  }

  const list = `${build}scenes.txt`;
  writeFileSync(list, sceneFiles.map((file) => `file '${file}'`).join("\n"));
  const final = path("findyourdent-demo.mp4");
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list, "-c:v", "copy",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", final,
  ]);

  const total = probeSeconds(final);
  for (const { scene, seconds } of plans) console.log(`${scene.id}\t${seconds.toFixed(1)}s`);
  console.log(`total\t${total.toFixed(2)}s (${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")})`);
  if (total < 180 || total > 240) throw new Error(`The video runs ${total}s; the rules require 3:00 to 4:00`);
}

function missing(id: string): never {
  throw new Error(`Unknown panel ${id}`);
}

if (import.meta.main) {
  await main();
}
