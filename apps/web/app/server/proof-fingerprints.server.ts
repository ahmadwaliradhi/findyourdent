// Proof Fingerprints in Firestore (spec 09): one per Testimony with an accepted or pending
// Proof of Visit, document id = Testimony id. The reuse check reads a place's set inside
// the transaction that stores the proof, so two submissions of one receipt cannot both
// be accepted: whichever commits second retries and sees the first one's fingerprint.
import { COLLECTIONS, type ProofFingerprintDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, type QuerySnapshot, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { ReuseMatchKind } from "~/lib/admin-queue";
import { fingerprintMatch, type ProofFingerprint } from "./proof-fingerprint.ts";

const fingerprints = (firestore: Firestore) => firestore.collection(COLLECTIONS.proofFingerprints);

export const fingerprintRef = (firestore: Firestore, testimonyId: string) => fingerprints(firestore).doc(testimonyId);

// Equality on one field needs no composite index; a place holds few fingerprints, so the
// comparison is a scan here (spec 09: no index on the hash).
const placeFingerprints = (firestore: Firestore, placeId: string) =>
  fingerprints(firestore).where("placeId", "==", placeId);

/** Another Testimony whose fingerprint matches, and how. */
export interface FingerprintMatch {
  testimonyId: string;
  matchedOn: ReuseMatchKind[];
}

/** The fingerprints in `place` that match `fingerprint`, leaving out the Testimony's own. */
function matchesIn(place: QuerySnapshot, testimonyId: string, fingerprint: ProofFingerprint): FingerprintMatch[] {
  return place.docs.flatMap((doc) => {
    if (doc.id === testimonyId) return [];
    const matchedOn = fingerprintMatch(fingerprint, doc.data() as ProofFingerprintDoc);
    return matchedOn.length > 0 ? [{ testimonyId: doc.id, matchedOn }] : [];
  });
}

/** The reuse check, as a transaction read: call it before the transaction's first write. */
export async function reuseMatchesIn(
  tx: Transaction,
  firestore: Firestore,
  input: { testimonyId: string; placeId: string; fingerprint: ProofFingerprint },
): Promise<FingerprintMatch[]> {
  const place = await tx.get(placeFingerprints(firestore, input.placeId));
  return matchesIn(place, input.testimonyId, input.fingerprint);
}

/**
 * What a Testimony's stored fingerprint matches now, for the admin queue. Read at load
 * time rather than stored on the Testimony: a matching Testimony deleted since has no
 * fingerprint any more and drops out.
 */
export async function storedReuseMatches(firestore: Firestore, testimonyId: string): Promise<FingerprintMatch[]> {
  const own = (await fingerprintRef(firestore, testimonyId).get()).data() as ProofFingerprintDoc | undefined;
  if (!own) return [];
  return matchesIn(await placeFingerprints(firestore, own.placeId).get(), testimonyId, own);
}

/** Stores (or replaces) a Testimony's fingerprint. Nothing else goes in: no image, no patient name. */
export function setFingerprint(
  tx: Transaction,
  firestore: Firestore,
  input: { testimonyId: string; placeId: string; fingerprint: ProofFingerprint },
): void {
  const doc: ProofFingerprintDoc = {
    testimonyId: input.testimonyId,
    placeId: input.placeId,
    ...input.fingerprint,
    createdAt: Timestamp.now(),
  };
  tx.set(fingerprintRef(firestore, input.testimonyId), doc);
}

/** Deletes a Testimony's fingerprint; a Testimony without one is fine. */
export function deleteFingerprint(tx: Transaction, firestore: Firestore, testimonyId: string): void {
  tx.delete(fingerprintRef(firestore, testimonyId));
}
