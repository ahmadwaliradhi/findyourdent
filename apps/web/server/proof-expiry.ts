/**
 * The proof expiry job (spec 09, ADR-0011). A Proof of Visit the decision sent to the
 * team waits at most 7 days: one nobody decided by then becomes `rejected` (`expired`)
 * and its file is deleted. Waiting is never a way in, so nothing here ever accepts.
 * The bucket's lifecycle rule on `proof-of-visit/` (infra/gcp/setup.sh) is the backstop
 * for the file.
 *
 * Runs from the Cloud Run job image, which has only server/ and app/lib/ unbundled:
 * relative imports, no `~` alias, nothing from app/server/.
 */
import { COLLECTIONS, type ProofOfVisitRecord, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Bucket } from "./firebase.ts";
import type { Logger } from "./logger.ts";
import { deleteStoredProofs, PROOF_RETENTION_DAYS } from "./proof-files.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/**
 * Cloud Scheduler runs the job this often (infra/gcp/deploy.sh). It expires what would
 * pass 7 days before the next run, so no proof waits longer than 7 days.
 */
export const PROOF_EXPIRY_EVERY_HOURS = 1;

export interface ExpireProofsOptions {
  firestore: Firestore;
  uploads: Bucket;
  logger: Logger;
  /** Epoch milliseconds. */
  now?: () => number;
}

export interface ExpirySummary {
  expired: number;
  /** A write or a file delete failed; the next run tries again (the file: the lifecycle rule). */
  failed: number;
}

export async function expireProofs({
  firestore,
  uploads,
  logger,
  now = Date.now,
}: ExpireProofsOptions): Promise<ExpirySummary> {
  // Checked at or before the cutoff: 7 days old by the next run.
  const cutoffMs = now() + PROOF_EXPIRY_EVERY_HOURS * HOUR_MS - PROOF_RETENTION_DAYS * DAY_MS;
  // Equality only, the date filtered here: a range on checkedAt would need a composite
  // index the emulator never asks for. The waiting set is small.
  const pending = await firestore
    .collection(COLLECTIONS.testimonies)
    .where("proofOfVisit.result", "==", "pending")
    .get();
  const due = pending.docs.filter(
    (doc) => ((doc.data() as TestimonyDoc).proofOfVisit?.checkedAt.toMillis() ?? 0) <= cutoffMs,
  );

  const summary: ExpirySummary = { expired: 0, failed: 0 };
  for (const doc of due) {
    try {
      // Decided meanwhile, or replaced by a newer proof whose file must stay: skip.
      if (!(await expireIfStillWaiting(firestore, doc.ref, cutoffMs))) continue;
      summary.expired += 1;
      await deleteStoredProofs(uploads, doc.id);
    } catch {
      summary.failed += 1;
    }
  }
  logger.info("proof_expiry", { outcome: "done", ...summary });
  return summary;
}

/** Expires the proof only if it still waits and is still old enough: an admin may have decided it meanwhile. */
async function expireIfStillWaiting(firestore: Firestore, ref: DocumentReference, cutoffMs: number): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const proof = ((await tx.get(ref)).data() as TestimonyDoc | undefined)?.proofOfVisit;
    if (proof?.result !== "pending" || proof.checkedAt.toMillis() > cutoffMs) return false;
    const { reasons: _waitedFor, ...facts } = proof;
    const expired: ProofOfVisitRecord = { ...facts, result: "rejected", reason: "expired" };
    tx.update(ref, { proofOfVisit: expired });
    return true;
  });
}
