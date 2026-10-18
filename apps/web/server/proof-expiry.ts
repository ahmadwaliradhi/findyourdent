/**
 * The proof expiry job (spec 09, ADR-0011). A Proof of Visit the decision sent to the
 * team waits at most 7 days: one nobody decided by then becomes `rejected` (`expired`)
 * and its file and Proof Fingerprint are deleted. Waiting is never a way in, so nothing
 * here ever accepts. Only the expired proof's own file goes (`filePath`): a proof the
 * author attached meanwhile keeps its file. The bucket's lifecycle rule on
 * `proof-of-visit/` (infra/gcp/setup.sh) is the backstop for the file.
 *
 * Runs from the Cloud Run job image, which has only server/ and app/lib/ unbundled:
 * relative imports, no `~` alias, nothing from app/server/.
 */
import { COLLECTIONS, type ProofOfVisitRecord, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Bucket } from "./firebase.ts";
import type { Logger } from "./logger.ts";
import { deleteProofFile, PROOF_RETENTION_DAYS } from "./proof-files.ts";
import { rejectWaitingProof } from "./waiting-proof.ts";

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

/** What one run did. Each due proof counts in exactly one of these. */
export interface ExpirySummary {
  /** Expired, its file deleted. */
  expired: number;
  /** Expired, but its file could not be deleted: the bucket's lifecycle rule deletes it. */
  expiredFileLeft: number;
  /** Not expired: the write failed, and the next run tries again. */
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
  const due = pending.docs.filter((doc) => isDue(doc.data() as TestimonyDoc, cutoffMs));

  const summary: ExpirySummary = { expired: 0, expiredFileLeft: 0, failed: 0 };
  for (const doc of due) {
    let expired: ProofOfVisitRecord | null;
    try {
      expired = await expireIfStillDue(firestore, doc.ref, cutoffMs);
    } catch {
      summary.failed += 1;
      continue;
    }
    // Decided or replaced meanwhile: nothing expired here.
    if (!expired) continue;
    try {
      if (expired.filePath) await deleteProofFile(uploads, expired.filePath);
      summary.expired += 1;
    } catch {
      summary.expiredFileLeft += 1;
    }
  }
  logger.info("proof_expiry", { outcome: "done", ...summary });
  return summary;
}

/**
 * A proof still waiting, checked at or before the cutoff. Never one on a deleted
 * Testimony: erasure takes the proof record, and one deleted before it did is left alone.
 */
function isDue(testimony: TestimonyDoc | undefined, cutoffMs: number): boolean {
  const proof = testimony?.proofOfVisit;
  return testimony?.status !== "deleted" && proof?.result === "pending" && proof.checkedAt.toMillis() <= cutoffMs;
}

/**
 * Expires the proof if it is still due (an admin or the author may have acted meanwhile)
 * and returns the waiting record it expired, whose file is now to be deleted; else null.
 */
async function expireIfStillDue(
  firestore: Firestore,
  ref: DocumentReference,
  cutoffMs: number,
): Promise<ProofOfVisitRecord | null> {
  return firestore.runTransaction(async (tx) => {
    const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
    const proof = testimony?.proofOfVisit;
    if (!proof || !isDue(testimony, cutoffMs)) return null;
    rejectWaitingProof(tx, firestore, ref, proof, { reason: "expired" });
    return proof;
  });
}
