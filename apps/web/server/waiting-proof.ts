// A Proof of Visit waiting for the team (spec 09), and how it stops waiting: an admin
// accepts or rejects it (app/server/proof-review.server.ts), or the proof expiry job
// rejects it after 7 days (server/proof-expiry.ts). Either way its own file is deleted
// once the decision is stored. Shared by the web service and the job, so it imports only
// what the Cloud Run job image has: relative files under server/ and the contracts.
import { COLLECTIONS, type ProofOfVisitRecord } from "@findyourdent/contracts/firestore";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

/** A Testimony's Proof Fingerprint: one per Testimony, document id = the Testimony id. */
export const fingerprintRef = (firestore: Firestore, testimonyId: string) =>
  firestore.collection(COLLECTIONS.proofFingerprints).doc(testimonyId);

/** How a waiting proof is turned down: by an admin with a note the author reads, or by the 7-day expiry. */
export type WaitingProofRejection = { reason: "adminRejected"; adminReason?: string } | { reason: "expired" };

/**
 * What a waiting proof keeps once decided: the facts read from it and the attempts, not
 * why it waited or where its file was.
 */
export function decidedRecord(
  waiting: ProofOfVisitRecord,
  decision: { result: "accepted" } | ({ result: "rejected" } & WaitingProofRejection),
): ProofOfVisitRecord {
  const { reasons: _waitedFor, filePath: _deletedNext, ...facts } = waiting;
  return { ...facts, ...decision };
}

/**
 * Turns a waiting proof down in the caller's transaction and drops its Proof Fingerprint:
 * a rejected proof keeps none. The caller deletes `waiting.filePath` once it commits.
 */
export function rejectWaitingProof(
  tx: Transaction,
  firestore: Firestore,
  ref: DocumentReference,
  waiting: ProofOfVisitRecord,
  rejection: WaitingProofRejection,
): void {
  tx.update(ref, { proofOfVisit: decidedRecord(waiting, { result: "rejected", ...rejection }) });
  tx.delete(fingerprintRef(firestore, ref.id));
}
