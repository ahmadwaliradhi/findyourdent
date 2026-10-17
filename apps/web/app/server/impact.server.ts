import { COLLECTIONS, IMPACT_COUNTERS, type TestimonyStatus } from "@findyourdent/contracts/firestore";
import {
  type DocumentData,
  type DocumentReference,
  FieldValue,
  type Firestore,
  type SetOptions,
  type WithFieldValue,
} from "firebase-admin/firestore";

/** One of the stored impact counters (`counters/{IMPACT_COUNTERS[key]}`). */
export type ImpactCounterKey = keyof typeof IMPACT_COUNTERS;

/** Signed increments to apply to the stored impact counters. Keys with no change are absent. */
export type ImpactDelta = Partial<Record<ImpactCounterKey, number>>;

/** What the impact counter needs to know about a Testimony at one point in time. */
export interface TestimonyImpactState {
  status: TestimonyStatus;
  /** Kunjungan terbukti. */
  verifiedVisit: boolean;
}

/** The public impact counter (spec 04). */
export interface ImpactCounts {
  testimoniesPublished: number;
  /** Distinct kota/kabupaten across Listed Providers. */
  kotaCovered: number;
  verifiedVisits: number;
  listedProviders: number;
  guidanceSessionsCompleted: number;
}

/**
 * Anything that can queue a write: a Firestore `Transaction` or `WriteBatch`.
 * Counter writes join the caller's transaction, so they commit (or roll back)
 * together with the Testimony or Provider change they describe.
 */
export interface ImpactWriter {
  set(ref: DocumentReference, data: WithFieldValue<DocumentData>, options: SetOptions): unknown;
}

/**
 * The counter change for one Testimony transition. `before` is null for a new
 * Testimony; `after` is null when the document is gone.
 *
 * Only `published` is public, so only crossings of that boundary count:
 * - entering `published` (from any other status, or created published): testimoniesPublished +1,
 *   and verifiedVisits +1 when it carries Kunjungan terbukti;
 * - leaving `published` (to removed, hidden, deleted, held, or any other status, or the
 *   document deleted): testimoniesPublished -1, and verifiedVisits -1 when it carried
 *   Kunjungan terbukti;
 * - staying `published` (an edit, a reply): nothing, except Kunjungan terbukti granted
 *   (verifiedVisits +1) or withdrawn (verifiedVisits -1);
 * - never `published` on either side: nothing, even if Kunjungan terbukti is granted
 *   (it counts when the Testimony is published).
 */
export function impactDeltaForStatusChange(
  before: TestimonyImpactState | null,
  after: TestimonyImpactState | null,
): ImpactDelta {
  const wasPublic = before?.status === "published";
  const isPublic = after?.status === "published";
  const testimonies = (isPublic ? 1 : 0) - (wasPublic ? 1 : 0);
  const verified = (isPublic && after?.verifiedVisit ? 1 : 0) - (wasPublic && before?.verifiedVisit ? 1 : 0);
  const delta: ImpactDelta = {};
  if (testimonies !== 0) delta.testimoniesPublished = testimonies;
  if (verified !== 0) delta.verifiedVisits = verified;
  return delta;
}

function counterRef(firestore: Firestore, key: ImpactCounterKey): DocumentReference {
  return firestore.collection(COLLECTIONS.counters).doc(IMPACT_COUNTERS[key]);
}

/** Queues `FieldValue.increment` writes for every non-zero entry of `delta`. */
export function applyImpactDelta(firestore: Firestore, writer: ImpactWriter, delta: ImpactDelta): void {
  for (const [key, amount] of Object.entries(delta) as [ImpactCounterKey, number][]) {
    if (!amount) continue;
    writer.set(
      counterRef(firestore, key),
      { value: FieldValue.increment(amount), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
}

/**
 * Call from every flow that changes a Testimony's status or Kunjungan terbukti
 * (Moderation, admin publish/hide/remove, author delete, Proof of Visit check),
 * inside the same transaction or batch as the Testimony write.
 */
export function recordTestimonyTransition(
  firestore: Firestore,
  writer: ImpactWriter,
  before: TestimonyImpactState | null,
  after: TestimonyImpactState | null,
): void {
  applyImpactDelta(firestore, writer, impactDeltaForStatusChange(before, after));
}

/** Call in the transaction that creates a Listed Provider (first published Testimony or a Claim). */
export function recordListedProviderCreated(firestore: Firestore, writer: ImpactWriter): void {
  applyImpactDelta(firestore, writer, { listedProviders: 1 });
}

/**
 * A Guidance session ended with a terminal answer (a Guidance card or an
 * Emergency Escalation). Only the counter moves; nothing about the session is stored.
 */
export async function recordGuidanceSessionCompleted(firestore: Firestore): Promise<void> {
  const batch = firestore.batch();
  applyImpactDelta(firestore, batch, { guidanceSessionsCompleted: 1 });
  await batch.commit();
}

const STORED_KEYS = Object.keys(IMPACT_COUNTERS) as ImpactCounterKey[];

/** Reads the public impact counter. Missing counters read 0; a counter never shows below 0. */
export async function readImpactCounter(firestore: Firestore | null): Promise<ImpactCounts> {
  const counts: ImpactCounts = {
    testimoniesPublished: 0,
    kotaCovered: 0,
    verifiedVisits: 0,
    listedProviders: 0,
    guidanceSessionsCompleted: 0,
  };
  if (!firestore) return counts;

  const [snapshots, providers] = await Promise.all([
    firestore.getAll(...STORED_KEYS.map((key) => counterRef(firestore, key))),
    firestore.collection(COLLECTIONS.providers).select("region.regencyCode").get(),
  ]);
  STORED_KEYS.forEach((key, index) => {
    const value: unknown = snapshots[index]?.get("value");
    counts[key] = typeof value === "number" && value > 0 ? value : 0;
  });
  const kota = new Set<string>();
  for (const doc of providers.docs) {
    const code: unknown = doc.get("region.regencyCode");
    if (typeof code === "string" && code !== "") kota.add(code);
  }
  counts.kotaCovered = kota.size;
  return counts;
}
