// Regenerates the detection eval results: `pnpm eval:detection [YYYY-MM-DD]`.
// Writes docs/research/detection-eval-<date>.md (default: today) and prints the hold rate per group.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evalGatesPass, formatResults, loadEvalFile, runDetectionEval } from "./run.ts";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD, got ${date}`);

const file = loadEvalFile();
// A fixed "now" keeps the timelines (hours ago) the same on every run.
const summary = runDetectionEval(file.cases, Date.UTC(2026, 10, 25, 12, 0, 0));
const out = fileURLToPath(new URL(`../../../../docs/research/detection-eval-${date}.md`, import.meta.url));
writeFileSync(out, formatResults(file, summary, date));

const pass = evalGatesPass(file.gates, summary);
console.log(
  `campaign ${summary.groups.campaign.held}/${summary.groups.campaign.total} held, genuine ${summary.groups.genuine.held}/${summary.groups.genuine.total} held -> ${out}`,
);
process.exit(pass.campaign && pass.genuine ? 0 : 1);
