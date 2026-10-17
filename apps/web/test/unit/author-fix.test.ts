import type { FlaggedSpan } from "@findyourdent/contracts";
import { describe, expect, it } from "vitest";
import { issuesBySentence, rulesWithoutSpan } from "../../app/lib/author-fix.ts";

const TEXT = "Dokternya sabar. Hubungi saja 0812-3456-7890 untuk janji. Ruangannya bersih.";
const PHONE: FlaggedSpan = { start: 30, end: 44, text: "0812-3456-7890", ruleCode: "r1_personal_data" };

describe("issuesBySentence", () => {
  it("shows the whole sentence around a flagged span, with the span marked inside it", () => {
    expect(issuesBySentence(TEXT, [PHONE])).toEqual([
      {
        sentence: "Hubungi saja 0812-3456-7890 untuk janji.",
        marks: [{ start: 13, end: 27 }],
        ruleCodes: ["r1_personal_data"],
      },
    ]);
  });

  it("gives one issue per sentence, in text order, joining spans that share a sentence", () => {
    const text = "Kata dokter, minum amoksisilin 3x500 mg saja.\nTelepon 0812-1111-2222 atau 0813-3333-4444!";
    const spans: FlaggedSpan[] = [
      { start: 74, end: 88, text: "0813-3333-4444", ruleCode: "r1_personal_data" },
      { start: 19, end: 39, text: "amoksisilin 3x500 mg", ruleCode: "r5_medical_advice" },
      { start: 54, end: 68, text: "0812-1111-2222", ruleCode: "r1_personal_data" },
    ];

    expect(issuesBySentence(text, spans)).toEqual([
      {
        sentence: "Kata dokter, minum amoksisilin 3x500 mg saja.",
        marks: [{ start: 19, end: 39 }],
        ruleCodes: ["r5_medical_advice"],
      },
      {
        sentence: "Telepon 0812-1111-2222 atau 0813-3333-4444!",
        marks: [
          { start: 8, end: 22 },
          { start: 28, end: 42 },
        ],
        ruleCodes: ["r1_personal_data"],
      },
    ]);
  });

  it("skips a span that does not match the text it points at", () => {
    expect(issuesBySentence(TEXT, [{ ...PHONE, text: "0899-0000-0000" }])).toEqual([]);
  });
});

describe("rulesWithoutSpan", () => {
  it("lists rules no span points at, such as R6 resting on the typed name", () => {
    expect(rulesWithoutSpan(["r1_personal_data", "r6_wrong_provider"], [PHONE])).toEqual(["r6_wrong_provider"]);
  });
});
