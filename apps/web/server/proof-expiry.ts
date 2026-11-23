/**
 * The 7-day proof expiry (spec 09, ADR-0011). A pending Proof of Visit waits for an
 * admin; one nobody decided within 7 days is rejected as `expired` and its file deleted,
 * so receipts never linger and nothing is ever accepted by timeout. The bucket lifecycle
 * rule on `proof-of-visit/` (infra/gcp/setup.sh) deletes any file older than 7 days as
 * the backstop. Pending proofs never count, so no aggregate or counter moves.
 */
import { COLLECTIONS, type ProofOfVisitRecord, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { Bucket } from "./firebase.ts";
import type { Logger } from "./logger.ts";

/** How long a pending proof may wait. Keep in step with the lifecycle rule in infra/gcp/setup.sh. */
export const PROOF_PENDING_MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpireProofsOptions {
  firestore: Firestore;
  uploads: Bucket;
  logger: Logger;
  /** Epoch milliseconds. */
  now?: () => number;
}

export interface ExpirySummary {
  expired: number;
  /** Firestore refused a write; the next run tries again. */
  failed: number;
}

/** One run, meant to be daily. */
export async function expirePendingProofs({
  firestore,
  uploads,
  logger,
  now = Date.now,
}: ExpireProofsOptions): Promise<ExpirySummary> {
  const at = Timestamp.fromMillis(now());
  const cutoffMs = at.toMillis() - PROOF_PENDING_MAX_DAYS * DAY_MS;
  // Equality on one field needs no composite index; the pending set is small (72-hour target).
  const pending = await firestore
    .collection(COLLECTIONS.testimonies)
    .where("proofOfVisit.result", "==", "pending")
    .get();
  const due = pending.docs.filter((doc) => {
    const proof = (doc.data() as TestimonyDoc).proofOfVisit;
    return proof?.result === "pending" && proof.checkedAt.toMillis() <= cutoffMs;
  });

  const summary: ExpirySummary = { expired: 0, failed: 0 };
  for (const doc of due) {
    try {
      // Re-read in the transaction: an admin may have decided it since the query.
      const filePath = await firestore.runTransaction(async (tx) => {
        const proof = ((await tx.get(doc.ref)).data() as TestimonyDoc | undefined)?.proofOfVisit;
        if (proof?.result !== "pending" || proof.checkedAt.toMillis() > cutoffMs) return null;
        const expired: ProofOfVisitRecord = {
          checkedAt: at,
          result: "rejected",
          reason: "expired",
        };
        tx.update(doc.ref, { proofOfVisit: expired, updatedAt: at });
        // A rejected proof keeps no Proof Fingerprint. Deleted here directly for the same
        // reason as the file below: proof-fingerprints.server.ts does not ship in the job image.
        tx.delete(firestore.collection(COLLECTIONS.proofFingerprints).doc(doc.id));
        return proof.filePath;
      });
      if (filePath === null) continue;
      // Only server/ and app/lib ship in the job image, so the file is deleted here directly.
      await uploads.file(filePath).delete({ ignoreNotFound: true });
      summary.expired += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error("proof_expiry", {
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info("proof_expiry", { outcome: "done", ...summary });
  return summary;
}
