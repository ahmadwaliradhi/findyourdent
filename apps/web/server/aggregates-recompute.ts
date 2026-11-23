/**
 * The release recompute (spec 09, ADR-0011): every Listed Provider's aggregates are
 * recomputed under the rule that only Proven Testimonies count, with no
 * grandfathering. Testimonies accepted under the old 24-month rule keep
 * `verifiedVisit` (their files are gone, so they cannot be checked again) and count as
 * Proven. Idempotent: a Provider whose aggregates are already right is not written.
 */
import {
  COLLECTIONS,
  type ProviderAggregates,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { computeAggregates } from "../app/server/aggregates.ts";
import type { Logger } from "./logger.ts";

export interface RecomputeAggregatesOptions {
  firestore: Firestore;
  logger: Logger;
}

export interface RecomputeSummary {
  providers: number;
  changed: number;
}

/** Deep equality for plain Firestore data (no Timestamps in aggregates). */
function sameAggregates(a: ProviderAggregates | undefined, b: ProviderAggregates): boolean {
  const canonical = (value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([key, inner]) => [key, canonical(inner)]),
        )
      : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export async function recomputeAllAggregates({
  firestore,
  logger,
}: RecomputeAggregatesOptions): Promise<RecomputeSummary> {
  const providers = await firestore.collection(COLLECTIONS.providers).get();
  let changed = 0;
  for (const providerDoc of providers.docs) {
    // In a transaction with the published Testimonies, so a Testimony posted meanwhile
    // either is in this read or retries it.
    const wrote = await firestore.runTransaction(async (tx) => {
      const published = await tx.get(
        firestore
          .collection(COLLECTIONS.testimonies)
          .where("placeId", "==", providerDoc.id)
          .where("status", "==", "published"),
      );
      const current = (await tx.get(providerDoc.ref)).data() as ProviderDoc | undefined;
      if (!current) return false;
      const aggregates = computeAggregates(published.docs.map((doc) => doc.data() as TestimonyDoc));
      if (sameAggregates(current.aggregates, aggregates)) return false;
      tx.update(providerDoc.ref, { aggregates, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (wrote) changed += 1;
  }
  const summary = { providers: providers.size, changed };
  logger.info("aggregates_recompute", { outcome: "done", ...summary });
  return summary;
}
