// The Proof of Visit decision (spec 09): the facts the agent read, the stated visit
// month, today in Asia/Jakarta and the reuse check in; accepted, pending or rejected out.
import type { ProofExtraction } from "@findyourdent/contracts";
import { describe, expect, it } from "vitest";
import { decideProof } from "../../app/lib/proof-decision.ts";

const TODAY = "2026-10-18";

function facts(overrides: Partial<ProofExtraction> = {}): ProofExtraction {
  return {
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "Klinik Gigi Ceria",
    proofDate: "2026-09-12",
    totalRupiah: 300_000,
    clinicNameMatches: true,
    ...overrides,
  };
}

const decide = (extraction: ProofExtraction, visitMonth = "2026-09", today = TODAY) =>
  decideProof({ extraction, visitMonth, today });

describe("decideProof", () => {
  it("accepts a readable proof naming the Provider, dated in the visit month", () => {
    expect(decide(facts())).toEqual({ result: "accepted" });
  });

  it("rejects an unreadable document, and one that is not a proof of a visit", () => {
    expect(decide({ readable: false, isProofOfVisit: false, clinicNameMatches: false })).toEqual({
      result: "rejected",
      reason: "unreadable",
    });
    // Unreadable wins whatever else the model said.
    expect(decide(facts({ readable: false }))).toEqual({ result: "rejected", reason: "unreadable" });
    expect(decide(facts({ isProofOfVisit: false }))).toEqual({ result: "rejected", reason: "notAProof" });
  });

  it("rejects a proof dated more than 12 months before today, whatever the visit month", () => {
    // Exactly 12 months old is still in time; a day more is not.
    expect(decide(facts({ proofDate: "2025-10-18" }), "2025-10")).toEqual({ result: "accepted" });
    expect(decide(facts({ proofDate: "2025-10-17" }), "2025-10")).toEqual({ result: "rejected", reason: "tooOld" });
    // Too old beats a mismatching name: the reason the author can act on comes first.
    expect(decide(facts({ proofDate: "2024-01-05", clinicNameMatches: false }))).toEqual({
      result: "rejected",
      reason: "tooOld",
    });
  });

  it("gives a month-only date the benefit of the doubt: the last day of that month", () => {
    // October 2025 may be the 31st, within 12 months of 18 October 2026.
    expect(decide(facts({ proofDate: "2025-10" }), "2025-10")).toEqual({ result: "accepted" });
    expect(decide(facts({ proofDate: "2025-09" }), "2025-09")).toEqual({ result: "rejected", reason: "tooOld" });
  });

  it("sends a name that does not match to an admin", () => {
    expect(decide(facts({ clinicNameMatches: false }))).toEqual({ result: "pending", reasons: ["nameMismatch"] });
  });

  it("sends a proof dated more than one month from the visit month to an admin", () => {
    // Visit September 2026: August to October are within one month, either way.
    for (const proofDate of ["2026-08-01", "2026-09-30", "2026-10-15", "2026-08"]) {
      expect(decide(facts({ proofDate }))).toEqual({ result: "accepted" });
    }
    for (const proofDate of ["2026-07-31", "2026-07"]) {
      expect(decide(facts({ proofDate }))).toEqual({ result: "pending", reasons: ["dateMismatch"] });
    }
    // Across the year end: visit January 2026, proof December 2025 is one month off.
    expect(decide(facts({ proofDate: "2025-12-20" }), "2026-01")).toEqual({ result: "accepted" });
    expect(decide(facts({ proofDate: "2025-11-20" }), "2026-01")).toEqual({
      result: "pending",
      reasons: ["dateMismatch"],
    });
  });

  it("sends a readable proof with no printed date to an admin, and needs no total", () => {
    const { proofDate: _, totalRupiah: __, ...undated } = facts();
    expect(decide(undated)).toEqual({ result: "pending", reasons: ["dateMismatch"] });
    const { totalRupiah: ___, ...untotalled } = facts();
    expect(decide(untotalled)).toEqual({ result: "accepted" });
  });

  it("accumulates every reason, the reuse check's included", () => {
    expect(
      decideProof({
        extraction: facts({ clinicNameMatches: false, proofDate: "2026-05-02" }),
        visitMonth: "2026-09",
        today: TODAY,
        reuse: { matched: true },
      }),
    ).toEqual({ result: "pending", reasons: ["nameMismatch", "dateMismatch", "possibleReuse"] });
    expect(decideProof({ extraction: facts(), visitMonth: "2026-09", today: TODAY, reuse: { matched: true } })).toEqual(
      { result: "pending", reasons: ["possibleReuse"] },
    );
  });

  it("measures today in the calendar, also across a leap day and the year end", () => {
    expect(decide(facts({ proofDate: "2027-02-28" }), "2027-02", "2028-02-29")).toEqual({ result: "accepted" });
    expect(decide(facts({ proofDate: "2025-12-31" }), "2026-01", "2027-01-01")).toEqual({
      result: "rejected",
      reason: "tooOld",
    });
  });
});
