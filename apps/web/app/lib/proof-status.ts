// What an author is told about their Proof of Visit (spec 09): accepted, waiting for the
// team, or not accepted with a plain reason. Shared by the submit answer and Testimoni saya.
import type { ProofOfVisitRecord, ProofRejectedReason } from "@findyourdent/contracts/firestore";

/** The author's view of a proof decision: never the file, the reasons for an admin or the facts read. */
export type AuthorProofStatus =
  | { result: "accepted" | "pending" }
  /** `reason` is absent on proofs rejected before spec 09; `adminReason` is the admin's note to the author. */
  | { result: "rejected"; reason?: ProofRejectedReason; adminReason?: string };

/**
 * A proof status with its plain sentence, as the submit answer carries it. `attemptsUsed`:
 * the proof sent with an edit was dropped unchecked (its file deleted) because the
 * Testimony had used all its proof attempts.
 */
export type AuthorProofFeedback = (AuthorProofStatus | { result: "attemptsUsed" }) & { message: string };

export function authorProofStatus(record: ProofOfVisitRecord): AuthorProofStatus {
  if (record.result !== "rejected") return { result: record.result };
  return {
    result: "rejected",
    ...(record.reason ? { reason: record.reason } : {}),
    ...(record.adminReason ? { adminReason: record.adminReason } : {}),
  };
}

export type ProofStatusKey =
  | "proofStatus.accepted"
  | "proofStatus.pending"
  | `proofStatus.rejected.${ProofRejectedReason | "other"}`;

/** The i18n key of the plain sentence for a proof status. */
export function proofStatusKey(status: AuthorProofStatus): ProofStatusKey {
  if (status.result !== "rejected") return `proofStatus.${status.result}`;
  return `proofStatus.rejected.${status.reason ?? "other"}`;
}
