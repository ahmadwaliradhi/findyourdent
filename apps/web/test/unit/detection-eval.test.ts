import { describe, expect, it } from "vitest";
import {
  type EvalCase,
  type EvalFile,
  evalGatesPass,
  formatResults,
  loadEvalFile,
  runDetectionEval,
} from "../../evals/detection/run.ts";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

const ALICE = { authorUid: "alice", ipHash: "ip-a", browserIdHash: "br-a" };
const BOB = { authorUid: "bob", ipHash: "ip-b", browserIdHash: "br-b" };
const LONG = "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih sekali.";

function testCase(overrides: Partial<EvalCase> & Pick<EvalCase, "id">): EvalCase {
  return {
    group: "genuine",
    expected: "publish",
    expectedRules: [],
    note: "",
    timeline: [],
    submission: { text: LONG, ...ALICE },
    ...overrides,
  };
}

describe("runDetectionEval", () => {
  it("publishes a lone submission and marks it correct when publish was expected", () => {
    const { cases } = runDetectionEval([testCase({ id: "lone" })], NOW);
    expect(cases).toEqual([
      { id: "lone", group: "genuine", expected: "publish", codes: [], held: false, correct: true, rulesMatch: true },
    ]);
  });

  it("fires D1 for a burst and D2 for a copy, from the timeline's hours ago", () => {
    const burst = testCase({
      id: "burst",
      group: "campaign",
      expected: "hold",
      expectedRules: ["D1"],
      timeline: [
        { hoursAgo: 1, text: "Bagus sekali pelayanannya, saya puas.", status: "published", ...BOB },
        {
          hoursAgo: 2,
          text: "Antrean cepat dan dokter ramah sekali.",
          status: "published",
          ...BOB,
          authorUid: "carol",
        },
      ],
    });
    const copy = testCase({
      id: "copy",
      group: "campaign",
      expected: "hold",
      expectedRules: ["D2"],
      timeline: [{ hoursAgo: 30, text: LONG, status: "held", ...BOB, ipHash: "x", browserIdHash: "y" }],
    });
    const { cases } = runDetectionEval([burst, copy], NOW);
    expect(cases.map((c) => [c.codes, c.held, c.correct, c.rulesMatch])).toEqual([
      [["D1"], true, true, true],
      [["D2"], true, true, true],
    ]);
  });

  it("fires D3 on another account's shared hash, never on the author's own", () => {
    const shared = testCase({
      id: "shared",
      group: "campaign",
      expected: "hold",
      expectedRules: ["D3"],
      timeline: [{ hoursAgo: 100, text: "Pelayanan baik.", status: "published", ...BOB, ipHash: "ip-a" }],
    });
    const own = testCase({
      id: "own",
      timeline: [{ hoursAgo: 100, text: "Pelayanan baik.", status: "published", ...ALICE }],
    });
    const { cases } = runDetectionEval([shared, own], NOW);
    expect(cases.map((c) => c.codes)).toEqual([["D3"], []]);
  });

  it("flags a wrong outcome and a rule mismatch", () => {
    const wrong = testCase({ id: "missed", group: "campaign", expected: "hold", expectedRules: ["D1"] });
    const { cases } = runDetectionEval([wrong], NOW);
    expect(cases[0]).toMatchObject({ held: false, correct: false, rulesMatch: false });
  });

  it("reports hold rate per group and rule counts per group", () => {
    const heldCampaign = testCase({
      id: "c1",
      group: "campaign",
      expected: "hold",
      expectedRules: ["D2"],
      timeline: [{ hoursAgo: 30, text: LONG, status: "published", ...BOB, ipHash: "x", browserIdHash: "y" }],
    });
    const slippedCampaign = testCase({ id: "c2", group: "campaign", expected: "hold" });
    const fineGenuine = testCase({ id: "g1" });
    const summary = runDetectionEval([heldCampaign, slippedCampaign, fineGenuine], NOW);
    expect(summary.groups.campaign).toEqual({ total: 2, held: 1, holdRate: 0.5 });
    expect(summary.groups.genuine).toEqual({ total: 1, held: 0, holdRate: 0 });
    expect(summary.ruleCounts).toEqual({
      campaign: { D1: 0, D2: 1, D3: 0 },
      genuine: { D1: 0, D2: 0, D3: 0 },
    });
  });

  it("has a hold rate of 0 for an empty group", () => {
    expect(runDetectionEval([], NOW).groups.campaign).toEqual({ total: 0, held: 0, holdRate: 0 });
  });
});

describe("known false holds", () => {
  const sharedWifi = testCase({
    id: "wifi",
    knownFalseHold: ["D3"],
    timeline: [{ hoursAgo: 100, text: "Pelayanan baik.", status: "published", ...BOB, ipHash: "ip-a" }],
  });

  it("match on the codes a case is known to fire, and are left out of the gated genuine rate", () => {
    const summary = runDetectionEval([sharedWifi, testCase({ id: "fine" })], NOW);
    expect(summary.cases[0]).toMatchObject({ codes: ["D3"], held: true, correct: false, rulesMatch: true });
    expect(summary.groups.genuine).toEqual({ total: 2, held: 1, holdRate: 0.5 });
    expect(summary.genuineWithoutKnownFalseHolds).toEqual({ total: 1, held: 0, holdRate: 0 });
  });

  it("show a drift when the known false hold stops firing", () => {
    const summary = runDetectionEval([{ ...sharedWifi, timeline: [] }], NOW);
    expect(summary.cases[0]).toMatchObject({ codes: [], rulesMatch: false });
  });
});

describe("deleted Testimonies", () => {
  it("count for D3 but not for D1 or D2", () => {
    const deleted = (hoursAgo: number) => ({
      hoursAgo,
      text: LONG,
      status: "deleted" as const,
      ...BOB,
      ipHash: "ip-a",
    });
    const burstOfDeleted = testCase({ id: "d", timeline: [deleted(1), deleted(2)] });
    const { cases } = runDetectionEval([burstOfDeleted], NOW);
    expect(cases[0]?.codes).toEqual(["D3"]);
  });
});

describe("evalGatesPass", () => {
  const rate = (held: number) => ({ total: 10, held, holdRate: held / 10 });
  const summary = (campaign: number, genuineGated: number) => ({
    groups: { campaign: rate(campaign), genuine: rate(9) },
    genuineWithoutKnownFalseHolds: rate(genuineGated),
  });
  const gates = { minCampaignHoldRate: 0.9, maxGenuineHoldRate: 0.1 };

  it("passes at exactly the gates and fails beyond them, gating genuine without the known false holds", () => {
    expect(evalGatesPass(gates, summary(9, 1))).toEqual({ campaign: true, genuine: true });
    expect(evalGatesPass(gates, summary(8, 1))).toEqual({ campaign: false, genuine: true });
    expect(evalGatesPass(gates, summary(10, 2))).toEqual({ campaign: true, genuine: false });
  });
});

describe("formatResults", () => {
  it("renders the date, labeller, per-case table, per-rule breakdown and hold rate per group", () => {
    const file: EvalFile = {
      labelling: { labeller: "ahmadwaliradhi", reviewedOn: "2026-11-25", status: "team-labelled" },
      gates: { minCampaignHoldRate: 0.5, maxGenuineHoldRate: 0.5 },
      findings: ["Shared wifi is held by D3."],
      cases: [
        testCase({
          id: "c1",
          group: "campaign",
          expected: "hold",
          expectedRules: ["D2"],
          timeline: [{ hoursAgo: 30, text: LONG, status: "published", ...BOB, ipHash: "x", browserIdHash: "y" }],
        }),
        testCase({ id: "g1" }),
      ],
    };
    const md = formatResults(file, runDetectionEval(file.cases, NOW), "2026-11-25");
    expect(md).toContain("# Detection evaluation, 2026-11-25");
    expect(md).toContain("Labels: team-labelled by ahmadwaliradhi");
    expect(md).toContain("| campaign | 1 | 1 | 1.000 |");
    expect(md).toContain("| genuine | 1 | 0 | 0.000 |");
    expect(md).toContain("| c1 | campaign | hold | hold | D2 | yes |");
    expect(md).toContain("| g1 | genuine | publish | publish | - | yes |");
    expect(md).toContain("| D2 | 1 | 0 |");
    expect(md).toContain("## Findings\n\n- Shared wifi is held by D3.");
  });

  it("says when the labels are not reviewed yet", () => {
    const file: EvalFile = {
      labelling: { labeller: "Claude", reviewedOn: null, status: "agent-drafted" },
      gates: { minCampaignHoldRate: 0, maxGenuineHoldRate: 1 },
      cases: [testCase({ id: "g1" })],
    };
    const md = formatResults(file, runDetectionEval(file.cases, NOW), "2026-11-25");
    expect(md).toContain("Labels: agent-drafted by Claude, not reviewed by the team yet");
  });
});

describe("committed detection cases", () => {
  const file = loadEvalFile();
  const summary = runDetectionEval(file.cases, NOW);

  it("name who labelled them and cover both groups", () => {
    expect(file.labelling.labeller).not.toBe("");
    expect(file.labelling.status).not.toBe("");
    expect(summary.groups.campaign.total).toBeGreaterThanOrEqual(16);
    expect(summary.groups.genuine.total).toBeGreaterThanOrEqual(16);
    expect(new Set(file.cases.map((c) => c.id)).size).toBe(file.cases.length);
  });

  it("meet the gates with the current thresholds", () => {
    expect(evalGatesPass(file.gates, summary)).toEqual({ campaign: true, genuine: true });
  });

  it("hold exactly the rules each case expects", () => {
    const mismatched = summary.cases.filter((c) => !c.rulesMatch).map((c) => c.id);
    expect(mismatched).toEqual([]);
  });
});
