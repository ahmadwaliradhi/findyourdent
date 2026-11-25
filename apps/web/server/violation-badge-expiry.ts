/**
 * The end of a Testimony Policy Violation badge (spec 09 part 2, issue #138). Six months
 * after a case is confirmed the public badge is removed from the Provider and its
 * aggregates are recomputed; the Testimonies marked `excludedByViolation` keep the mark,
 * so they stay out of the aggregates for good. The badge also stops showing on its own
 * once `badgeUntil` has passed (the pages check the date); this job tidies the document.
 * Only server/ and app/lib ship in the job image beside the shared aggregates rule.
 */
import {
  COLLECTIONS,
  type PolicyViolationDoc,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { computeAggregates } from "../app/server/aggregates.ts";
import type { Logger } from "./logger.ts";

export interface EndViolationBadgesOptions {
  firestore: Firestore;
  logger: Logger;
  /** Epoch milliseconds. */
  now?: () => number;
}

export interface BadgeEndSummary {
  ended: number;
  /** Firestore refused a write; the next run tries again. */
  failed: number;
}

/** One run, meant to be daily. */
export async function endExpiredViolationBadges({
  firestore,
  logger,
  now = Date.now,
}: EndViolationBadgesOptions): Promise<BadgeEndSummary> {
  const at = Timestamp.fromMillis(now());
  // One field with an inequality needs no composite index; only Providers with a badge have it.
  const due = await firestore.collection(COLLECTIONS.providers).where("violationBadge.badgeUntil", "<=", at).get();

  const summary: BadgeEndSummary = { ended: 0, failed: 0 };
  for (const providerDoc of due.docs) {
    try {
      const wrote = await firestore.runTransaction(async (tx) => {
        // Re-read in the transaction: the badge may have been ended since the query.
        const current = (await tx.get(providerDoc.ref)).data() as ProviderDoc | undefined;
        const badge = current?.violationBadge;
        if (!badge || badge.badgeUntil.toMillis() > at.toMillis()) return false;
        const [published, violation] = await Promise.all([
          tx.get(
            firestore
              .collection(COLLECTIONS.testimonies)
              .where("placeId", "==", providerDoc.id)
              .where("status", "==", "published"),
          ),
          tx.get(firestore.collection(COLLECTIONS.policyViolations).doc(badge.violationId)),
        ]);
        tx.update(providerDoc.ref, {
          violationBadge: FieldValue.delete(),
          aggregates: computeAggregates(published.docs.map((doc) => doc.data() as TestimonyDoc)),
          updatedAt: at,
        });
        if (violation.exists && !(violation.data() as PolicyViolationDoc).badgeEndedAt) {
          tx.update(violation.ref, { badgeEndedAt: at, updatedAt: at });
        }
        return true;
      });
      if (wrote) summary.ended += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error("violation_badge_expiry", {
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info("violation_badge_expiry", { outcome: "done", ...summary });
  return summary;
}
