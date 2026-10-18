/**
 * The release recompute job (spec 09, ADR-0011): every Listed Provider's aggregates
 * recomputed from its published Testimonies under "only Proven Testimonies count",
 * with no grandfathering. Run once by hand at the spec 09 release (infra/gcp/README.md).
 * Testimonies are only read: those accepted under the old 24-month rule keep
 * `verifiedVisit` and stay Proven. Safe to run again: a Provider whose aggregates are
 * already right is not written.
 */
import { isDeepStrictEqual } from "node:util";
import { COLLECTIONS, type ProviderDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { type DocumentReference, type Firestore, Timestamp } from "firebase-admin/firestore";
import { computeAggregates } from "../app/server/aggregates.ts";
import type { Logger } from "./logger.ts";

export interface RecomputeAggregatesOptions {
  firestore: Firestore;
  logger: Logger;
}

export interface RecomputeSummary {
  providers: number;
  /** Providers whose stored aggregates differed and were rewritten. */
  changed: number;
  /** Firestore refused a read or write; running the job again retries them. */
  failed: number;
}

export async function recomputeAggregates({
  firestore,
  logger,
}: RecomputeAggregatesOptions): Promise<RecomputeSummary> {
  const providers = await firestore.collection(COLLECTIONS.providers).select().get();
  const summary: RecomputeSummary = { providers: providers.size, changed: 0, failed: 0 };
  for (const { ref } of providers.docs) {
    try {
      if (await recomputeOne(firestore, ref)) summary.changed += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error("aggregates_recompute", {
        outcome: "provider_failed",
        placeId: ref.id,
        error: error instanceof Error ? error.name : "unknown",
        ...(error instanceof Error && "code" in error && typeof error.code === "number" ? { code: error.code } : {}),
      });
    }
  }
  logger.info("aggregates_recompute", { outcome: "done", ...summary });
  return summary;
}

/**
 * Reads the Provider and its published Testimonies in one transaction, as every
 * Testimony write does, so a Testimony landing meanwhile is never lost. Returns
 * whether it wrote.
 */
function recomputeOne(firestore: Firestore, ref: DocumentReference): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const provider = await tx.get(ref);
    if (!provider.exists) return false;
    const published = await tx.get(
      firestore.collection(COLLECTIONS.testimonies).where("placeId", "==", ref.id).where("status", "==", "published"),
    );
    const aggregates = computeAggregates(published.docs.map((doc) => doc.data() as TestimonyDoc));
    if (isDeepStrictEqual(aggregates, (provider.data() as ProviderDoc).aggregates)) return false;
    tx.update(ref, { aggregates, updatedAt: Timestamp.now() });
    return true;
  });
}
