import type { ProofOfVisitExtraction } from "@findyourdent/contracts";
import { describe, expect, it } from "vitest";
import { decideProof } from "../../app/server/proof-decision.ts";

/** A readable receipt from the right clinic, dated in the visit month. */
const receipt = (overrides: Partial<ProofOfVisitExtraction> = {}): ProofOfVisitExtraction => ({
  readable: true,
  isProofOfVisit: true,
  clinicNameOnProof: "Klinik Gigi Senyum Sehat",
  proofDate: "2026-08-14",
  totalRupiah: 350_000,
  clinicNameMatches: true,
  ...overrides,
});

const TODAY = "2026-11-22";
const decide = (extraction: ProofOfVisitExtraction | undefined, visitMonth = "2026-08", today = TODAY) =>
  decideProof(extraction, { visitMonth, today });

describe("decideProof", () => {
  it("accepts a readable proof from the right clinic dated in the visit month", () => {
    expect(decide(receipt())).toEqual({ result: "accepted" });
  });

  it("rejects an unreadable proof", () => {
    expect(decide(receipt({ readable: false, isProofOfVisit: false, clinicNameMatches: false }))).toEqual({
      result: "rejected",
      reason: "unreadable",
    });
  });

  it("sends a proof to the admin when the check did not run, rather than blaming the file", () => {
    expect(decide(undefined)).toEqual({ result: "pending", reasons: ["notChecked"] });
  });

  it("rejects a document that is not a proof of visit", () => {
    expect(decide(receipt({ isProofOfVisit: false }))).toEqual({ result: "rejected", reason: "notAProof" });
  });

  it("rejects a proof dated more than 12 months before today, before any other check", () => {
    expect(decide(receipt({ proofDate: "2025-11-21", clinicNameMatches: false }), "2025-11")).toEqual({
      result: "rejected",
      reason: "tooOld",
    });
  });

  it("accepts a proof dated exactly 12 months before today", () => {
    expect(decide(receipt({ proofDate: "2025-11-22" }), "2025-11")).toEqual({ result: "accepted" });
  });

  it("judges a month-only date by its month: 12 months back is still in time, 13 is too old", () => {
    expect(decide(receipt({ proofDate: "2025-11" }), "2025-11")).toEqual({ result: "accepted" });
    expect(decide(receipt({ proofDate: "2025-10" }), "2025-10")).toEqual({ result: "rejected", reason: "tooOld" });
  });

  it("sends a proof with another clinic's name to the admin", () => {
    expect(decide(receipt({ clinicNameMatches: false }))).toEqual({ result: "pending", reasons: ["nameMismatch"] });
  });

  it("accepts a proof dated one month either side of the visit month", () => {
    expect(decide(receipt({ proofDate: "2026-07-31" }))).toEqual({ result: "accepted" });
    expect(decide(receipt({ proofDate: "2026-09-01" }))).toEqual({ result: "accepted" });
  });

  it("sends a proof dated more than one month from the visit month to the admin, across a year end", () => {
    expect(decide(receipt({ proofDate: "2026-06-30" }))).toEqual({ result: "pending", reasons: ["dateMismatch"] });
    expect(decide(receipt({ proofDate: "2026-01" }), "2025-12", "2026-02-01")).toEqual({ result: "accepted" });
    expect(decide(receipt({ proofDate: "2026-02-01" }), "2025-12", "2026-02-10")).toEqual({
      result: "pending",
      reasons: ["dateMismatch"],
    });
  });

  it("sends a proof dated after today to the admin, even inside the visit-month window", () => {
    expect(decide(receipt({ proofDate: "2026-11-23" }), "2026-11")).toEqual({
      result: "pending",
      reasons: ["dateMismatch"],
    });
    expect(decide(receipt({ proofDate: "2026-12" }), "2026-11")).toEqual({
      result: "pending",
      reasons: ["dateMismatch"],
    });
    expect(decide(receipt({ proofDate: "2026-11" }), "2026-11")).toEqual({ result: "accepted" });
  });

  it("sends a proof with no readable date to the admin", () => {
    expect(decide(receipt({ proofDate: undefined }))).toEqual({ result: "pending", reasons: ["dateMismatch"] });
  });

  it("accumulates the reasons a proof waits for the admin", () => {
    expect(decide(receipt({ clinicNameMatches: false, proofDate: "2026-03-02" }))).toEqual({
      result: "pending",
      reasons: ["nameMismatch", "dateMismatch"],
    });
  });
});
