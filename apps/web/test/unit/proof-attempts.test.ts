import type { ProofOfVisitRecord } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import {
  MAX_PROOF_ATTEMPTS,
  proofAttachRefusal,
  proofAttemptsLeft,
  proofAttemptsUsed,
} from "../../app/lib/testimony.ts";

const rejected: ProofOfVisitRecord = { checkedAt: Timestamp.now(), result: "rejected", reason: "unreadable" };
const pending: ProofOfVisitRecord = {
  checkedAt: Timestamp.now(),
  result: "pending",
  reasons: ["nameMismatch"],
  filePath: "proof-of-visit/t/1.jpg",
};
const accepted: ProofOfVisitRecord = { checkedAt: Timestamp.now(), result: "accepted" };

describe("proof attempts", () => {
  it("allows three proof checks per Testimony", () => {
    expect(MAX_PROOF_ATTEMPTS).toBe(3);
  });

  it("reads the stored count when there is one", () => {
    expect(proofAttemptsUsed({ proofAttempts: 2, proofOfVisit: rejected })).toBe(2);
    expect(proofAttemptsLeft({ proofAttempts: 2, proofOfVisit: rejected })).toBe(1);
  });

  it("counts one for a Testimony stored before the count with a proof decision, none without", () => {
    expect(proofAttemptsUsed({ proofOfVisit: rejected })).toBe(1);
    expect(proofAttemptsUsed({})).toBe(0);
    expect(proofAttemptsLeft({})).toBe(3);
  });

  it("never reports fewer than zero left", () => {
    expect(proofAttemptsLeft({ proofAttempts: 5 })).toBe(0);
  });
});

describe("proof attach refusal", () => {
  const published = { status: "published" as const, verifiedVisit: false };

  it("allows a published Testimony without a proof, or after a rejected one with attempts left", () => {
    expect(proofAttachRefusal(published)).toBeNull();
    expect(proofAttachRefusal({ ...published, proofOfVisit: rejected, proofAttempts: 2 })).toBeNull();
  });

  it("refuses in order: not published, already proven, pending with the team, attempts used", () => {
    expect(proofAttachRefusal({ ...published, status: "held", proofOfVisit: accepted })).toBe("not_published");
    expect(proofAttachRefusal({ ...published, proofOfVisit: accepted })).toBe("already_proven");
    expect(proofAttachRefusal({ ...published, verifiedVisit: true })).toBe("already_proven");
    expect(proofAttachRefusal({ ...published, proofOfVisit: pending, proofAttempts: 3 })).toBe("proof_pending");
    expect(proofAttachRefusal({ ...published, proofOfVisit: rejected, proofAttempts: 3 })).toBe("proof_attempts_used");
  });
});
