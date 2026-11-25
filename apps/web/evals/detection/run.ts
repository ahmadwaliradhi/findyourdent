// Detection eval (spec 09 part 2, issue #135): runs hand-written campaign and genuine-Provider
// scenarios through the pure detection module and reports the hold rate per group.
// Pure apart from `loadEvalFile`; `report.ts` writes the results to docs/research.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DetectionRuleCode } from "../../app/server/detection.ts";
import {
  detectionRuleCodes,
  SIMILARITY_COMPARED_STATUSES,
  SIMILARITY_THRESHOLD,
  VELOCITY_DAY_THRESHOLD,
  VELOCITY_DAY_WINDOW_MS,
  VELOCITY_WEEK_THRESHOLD,
  VELOCITY_WEEK_WINDOW_MS,
} from "../../app/server/detection.ts";

const HOUR_MS = 60 * 60 * 1000;
const RULES: readonly DetectionRuleCode[] = ["D1", "D2", "D3"];

export type EvalGroup = "campaign" | "genuine";

/** An earlier Testimony of the Provider: when it was submitted, its text and the device behind it. */
export interface EvalTimelineEntry {
  hoursAgo: number;
  text: string;
  /** A deleted Testimony counts for D3 only: not in D1's count, not in D2's texts. */
  status: "published" | "held" | "deleted";
  authorUid: string;
  ipHash: string;
  browserIdHash: string;
}

/** The new submission detection looks at. */
export interface EvalSubmission {
  text: string;
  authorUid: string;
  ipHash: string;
  browserIdHash: string;
}

export interface EvalCase {
  id: string;
  group: EvalGroup;
  expected: "hold" | "publish";
  /** The rule codes the team expects to fire (empty for a publish). */
  expectedRules: DetectionRuleCode[];
  /** Set when the case sits close to a threshold, so a threshold change is likely to flip it. */
  nearThreshold?: boolean;
  /**
   * A genuine case the rule's definition holds and no threshold can fix: the codes that fire today.
   * The expected outcome stays publish; this only says what the eval accepts as the current behaviour.
   */
  knownFalseHold?: DetectionRuleCode[];
  note: string;
  timeline: EvalTimelineEntry[];
  submission: EvalSubmission;
}

export interface EvalGates {
  /** At least this share of campaign cases must be held. */
  minCampaignHoldRate: number;
  /** At most this share of genuine cases may be held (false holds). */
  maxGenuineHoldRate: number;
}

export interface EvalFile {
  /** `reviewedOn` stays null until the team has signed the labels off. */
  labelling: { labeller: string; reviewedOn: string | null; status: string };
  gates: EvalGates;
  /** What the committed thresholds were before the last tuning, kept so the report can show both. */
  baseline?: {
    note: string;
    constants: Record<string, number>;
    campaignHoldRate: number;
    genuineHoldRate: number;
    genuineWithoutKnownFalseHoldsRate: number;
  };
  /** What the team learned from the run, in prose; the report prints them last. */
  findings?: string[];
  cases: EvalCase[];
}

export interface CaseResult {
  id: string;
  group: EvalGroup;
  expected: "hold" | "publish";
  codes: DetectionRuleCode[];
  held: boolean;
  /** The outcome is the expected one. */
  correct: boolean;
  /** The codes fired are exactly the expected ones. */
  rulesMatch: boolean;
}

export interface GroupRate {
  total: number;
  held: number;
  holdRate: number;
}

export interface EvalSummary {
  cases: CaseResult[];
  groups: Record<EvalGroup, GroupRate>;
  /** The genuine cases without a known false hold: the ones a threshold can fix, and the gated rate. */
  genuineWithoutKnownFalseHolds: GroupRate;
  /** How often each rule fired, per group. */
  ruleCounts: Record<EvalGroup, Record<DetectionRuleCode, number>>;
}

/** Runs each case through `detectionRuleCodes` as the web service would at submission. */
export function runDetectionEval(cases: readonly EvalCase[], nowMs: number): EvalSummary {
  const results = cases.map((testCase): CaseResult => {
    const { timeline, submission } = testCase;
    const codes = detectionRuleCodes({
      otherSubmittedAtMs: timeline
        .filter((entry) => entry.status !== "deleted")
        .map((entry) => nowMs - entry.hoursAgo * HOUR_MS),
      nowMs,
      sharedDevice: {
        mine: { ipHash: submission.ipHash, browserIdHash: submission.browserIdHash },
        others: timeline.map(({ authorUid, ipHash, browserIdHash }) => ({ authorUid, ipHash, browserIdHash })),
        authorUid: submission.authorUid,
      },
      text: submission.text,
      comparableTexts: timeline
        .filter((entry) => (SIMILARITY_COMPARED_STATUSES as readonly string[]).includes(entry.status))
        .map((entry) => entry.text),
    });
    const held = codes.length > 0;
    return {
      id: testCase.id,
      group: testCase.group,
      expected: testCase.expected,
      codes,
      held,
      correct: held === (testCase.expected === "hold"),
      rulesMatch: codes.join() === (testCase.knownFalseHold ?? testCase.expectedRules).join(),
    };
  });

  const rateOf = (inGroup: readonly CaseResult[]): GroupRate => {
    const held = inGroup.filter((result) => result.held).length;
    return { total: inGroup.length, held, holdRate: inGroup.length === 0 ? 0 : held / inGroup.length };
  };
  const rate = (group: EvalGroup) => rateOf(results.filter((result) => result.group === group));
  const known = new Set(cases.filter((testCase) => testCase.knownFalseHold).map((testCase) => testCase.id));
  const counts = (group: EvalGroup) =>
    Object.fromEntries(
      RULES.map((rule) => [rule, results.filter((r) => r.group === group && r.codes.includes(rule)).length]),
    ) as Record<DetectionRuleCode, number>;

  return {
    cases: results,
    groups: { campaign: rate("campaign"), genuine: rate("genuine") },
    genuineWithoutKnownFalseHolds: rateOf(results.filter((r) => r.group === "genuine" && !known.has(r.id))),
    ruleCounts: { campaign: counts("campaign"), genuine: counts("genuine") },
  };
}

/** Whether each group meets its gate; the genuine gate leaves out the known false holds. */
export function evalGatesPass(
  gates: EvalGates,
  summary: Pick<EvalSummary, "groups" | "genuineWithoutKnownFalseHolds">,
): Record<EvalGroup, boolean> {
  return {
    campaign: summary.groups.campaign.holdRate >= gates.minCampaignHoldRate,
    genuine: summary.genuineWithoutKnownFalseHolds.holdRate <= gates.maxGenuineHoldRate,
  };
}

/** The committed cases (`cases.json` beside this file). */
export function loadEvalFile(): EvalFile {
  return JSON.parse(readFileSync(fileURLToPath(new URL("./cases.json", import.meta.url)), "utf8")) as EvalFile;
}

const fixed = (value: number) => value.toFixed(3);
const hoursOf = (ms: number) => ms / HOUR_MS;

/** The current constants, as the report states them. */
export function currentConstants(): Record<string, number> {
  return {
    VELOCITY_DAY_THRESHOLD,
    VELOCITY_DAY_WINDOW_HOURS: hoursOf(VELOCITY_DAY_WINDOW_MS),
    VELOCITY_WEEK_THRESHOLD,
    VELOCITY_WEEK_WINDOW_HOURS: hoursOf(VELOCITY_WEEK_WINDOW_MS),
    SIMILARITY_THRESHOLD,
  };
}

/** The results as a markdown report (same shape as the moderation eval results). */
export function formatResults(file: EvalFile, summary: EvalSummary, date: string): string {
  const { gates, labelling, cases: testCases } = file;
  const { groups, ruleCounts } = summary;
  const pass = evalGatesPass(gates, summary);
  const tunable = summary.genuineWithoutKnownFalseHolds;
  const byId = new Map(testCases.map((testCase) => [testCase.id, testCase]));
  const lines: string[] = [
    `# Detection evaluation, ${date}`,
    "",
    "- Detection under test: `apps/web/app/server/detection.ts` (D1 velocity, D2 similarity, D3 sharedDevice)",
    `- Labels: ${labelling.status} by ${labelling.labeller}, ${labelling.reviewedOn ? `reviewed ${labelling.reviewedOn}` : "not reviewed by the team yet"}`,
    `- Cases: ${testCases.length} (${groups.campaign.total} campaign, ${groups.genuine.total} genuine)`,
    `- Constants: ${Object.entries(currentConstants())
      .map(([name, value]) => `\`${name}\` ${value}`)
      .join(", ")}`,
    "",
    "| Gate | Threshold | Value | Result |",
    "|---|---|---|---|",
    `| campaign hold rate | >= ${gates.minCampaignHoldRate} | ${fixed(groups.campaign.holdRate)} | ${pass.campaign ? "pass" : "fail"} |`,
    `| genuine hold rate without known false holds | <= ${gates.maxGenuineHoldRate} | ${fixed(tunable.holdRate)} | ${pass.genuine ? "pass" : "fail"} |`,
    "",
    "## Hold rate per group",
    "",
    "| Group | Cases | Held | Hold rate |",
    "|---|---|---|---|",
    `| campaign | ${groups.campaign.total} | ${groups.campaign.held} | ${fixed(groups.campaign.holdRate)} |`,
    `| genuine | ${groups.genuine.total} | ${groups.genuine.held} | ${fixed(groups.genuine.holdRate)} |`,
    `| genuine without known false holds | ${tunable.total} | ${tunable.held} | ${fixed(tunable.holdRate)} |`,
    "",
    "A known false hold is a genuine case that a rule's definition holds and no threshold can fix (see the last section); the gate leaves them out, the first genuine row counts them.",
    "",
  ];
  if (file.baseline) {
    lines.push(
      "## Before tuning",
      "",
      file.baseline.note,
      "",
      `- Constants before: ${Object.entries(file.baseline.constants)
        .map(([name, value]) => `\`${name}\` ${value}`)
        .join(", ")}`,
      `- Campaign hold rate before ${fixed(file.baseline.campaignHoldRate)}, after ${fixed(groups.campaign.holdRate)}`,
      `- Genuine hold rate before ${fixed(file.baseline.genuineHoldRate)}, after ${fixed(groups.genuine.holdRate)}`,
      `- Genuine hold rate without known false holds before ${fixed(file.baseline.genuineWithoutKnownFalseHoldsRate)}, after ${fixed(tunable.holdRate)}`,
      "",
    );
  }
  lines.push(
    "## Per-rule breakdown",
    "",
    "Cases in which each rule fired (a case can fire more than one).",
    "",
    "| Rule | Campaign | Genuine |",
    "|---|---|---|",
    ...RULES.map((rule) => `| ${rule} | ${ruleCounts.campaign[rule]} | ${ruleCounts.genuine[rule]} |`),
    "",
    `- Campaign cases that slipped through: ${listOrNone(summary.cases.filter((r) => r.group === "campaign" && !r.held))}`,
    `- Genuine cases held (false holds): ${listOrNone(summary.cases.filter((r) => r.group === "genuine" && r.held))}`,
    `- Cases whose fired rules differ from the expected ones: ${listOrNone(summary.cases.filter((r) => !r.rulesMatch))}`,
    "",
    "## Cases",
    "",
    "| Case | Group | Expected | Outcome | Rules fired | Rules as expected |",
    "|---|---|---|---|---|---|",
    ...summary.cases.map(
      (r) =>
        `| ${r.id} | ${r.group} | ${r.expected} | ${r.held ? "hold" : "publish"} | ${r.codes.length ? r.codes.join(", ") : "-"} | ${r.rulesMatch ? "yes" : "no"} |`,
    ),
    "",
  );
  const noted = summary.cases.filter((r) => byId.get(r.id)?.nearThreshold || byId.get(r.id)?.knownFalseHold);
  if (noted.length > 0) {
    lines.push(
      "## Near-threshold cases and known false holds",
      "",
      "| Case | Kind | Note |",
      "|---|---|---|",
      ...noted.map((r) => {
        const testCase = byId.get(r.id);
        const kind = testCase?.knownFalseHold
          ? `known false hold (${testCase.knownFalseHold.join(", ")})`
          : "near threshold";
        return `| ${r.id} | ${kind} | ${testCase?.note ?? ""} |`;
      }),
      "",
    );
  }
  if (file.findings?.length) lines.push("## Findings", "", ...file.findings.map((finding) => `- ${finding}`), "");
  return lines.join("\n");
}

function listOrNone(results: readonly CaseResult[]): string {
  return results.length === 0 ? "none" : results.map((r) => r.id).join(", ");
}
