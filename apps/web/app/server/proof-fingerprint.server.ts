// Proof Fingerprint and the reuse check (spec 09, ADR-0011): what is kept of an accepted
// or pending Proof of Visit once its file is gone, so one real receipt cannot unlock
// several Testimonies. Never the file, never the patient's name.
//
// - Images: a 64-bit DCT perceptual hash (pHash). The stored JPEG goes to 32x32
//   greyscale, its 8x8 lowest DCT frequencies are compared with their median, one bit
//   each. The median makes half the bits ones, so a mostly white receipt does not
//   collapse into a nearly empty hash the way a difference hash (dHash) does on blank
//   paper; it survives re-encoding, a little cropping and a brightness change.
// - PDFs: SHA-256 of the bytes as sent (stored unchanged).
// - Key: `normalizeName(clinicNameOnProof)|proofDate|totalRupiah`. Not kept when too
//   weak to tell two visits apart: no date (the name and a standard price repeat across
//   years), or a month-only date without a total (every visit to the clinic that month).
//
// Reuse: another Testimony's fingerprint at the same `placeId` with the same key, the
// same file hash, or a perceptual hash within 10 bits. The per-Provider set is small:
// one equality query, compared here.
import { createHash } from "node:crypto";
import type { ProofExtraction } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  type ProofFacts,
  type ProofFingerprintDoc,
  type ProofOfVisitRecord,
} from "@findyourdent/contracts/firestore";
import type { Firestore, QuerySnapshot, Timestamp, Transaction } from "firebase-admin/firestore";
import sharp from "sharp";
import { normalizeName } from "~/lib/normalize-name";
import type { Bucket } from "../../server/firebase.ts";
import { isPdfProof } from "../../server/proof-files.ts";
import { fingerprintRef } from "../../server/waiting-proof.ts";

/** Perceptual hashes this many bits apart or fewer are the same receipt (spec 09). */
export const REUSE_MAX_HAMMING_BITS = 10;

/** What a Proof Fingerprint compares: one file hash, and the key when it is strong enough. */
export type ProofFingerprint = Pick<ProofFingerprintDoc, "perceptualHash" | "fileSha256" | "fieldsKey">;

/** Every fingerprint kept for a place: what a new proof there is checked against. */
export const placeFingerprints = (firestore: Firestore, placeId: string) =>
  firestore.collection(COLLECTIONS.proofFingerprints).where("placeId", "==", placeId);

/** The fingerprint of a stored proof file (`.pdf` or a re-encoded `.jpg`) and the facts read from it. */
export async function fingerprintStoredProof(
  uploads: Bucket,
  proofPath: string,
  extraction: ProofExtraction,
): Promise<ProofFingerprint> {
  const [bytes] = await uploads.file(proofPath).download();
  const key = fieldsKey(extraction);
  return {
    ...(isPdfProof(proofPath)
      ? { fileSha256: createHash("sha256").update(bytes).digest("hex") }
      : { perceptualHash: await perceptualHash(bytes) }),
    ...(key ? { fieldsKey: key } : {}),
  };
}

/** The key from the facts read, or undefined when it is too weak to match on. */
export function fieldsKey({ clinicNameOnProof, proofDate, totalRupiah }: ProofFacts): string | undefined {
  if (!proofDate) return undefined;
  const monthOnly = proofDate.length === "YYYY-MM".length;
  if (monthOnly && totalRupiah === undefined) return undefined;
  return [normalizeName(clinicNameOnProof ?? ""), proofDate, totalRupiah ?? ""].join("|");
}

const SIDE = 32;
const LOW = 8;
/** cos((2x + 1) u π / 2N): the DCT-II basis for the lowest LOW frequencies over SIDE pixels. */
const BASIS = Array.from({ length: LOW }, (_, u) =>
  Array.from({ length: SIDE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIDE))),
);

/** 64-bit pHash of an image, as 16 hex digits. */
export async function perceptualHash(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image, { failOn: "error" })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(SIDE, SIDE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => data[(y * SIDE + x) * info.channels] as number;
  // Separable 2D DCT: rows first, then columns, keeping only the low frequencies.
  const rows = Array.from({ length: SIDE }, (_, y) =>
    BASIS.map((basis) => basis.reduce((sum, c, x) => sum + c * pixel(x, y), 0)),
  );
  const coefficients = BASIS.flatMap((basis) =>
    Array.from({ length: LOW }, (_, v) => basis.reduce((sum, c, y) => sum + c * (rows[y]?.[v] ?? 0), 0)),
  );
  const sorted = [...coefficients].sort((a, b) => a - b);
  const median = ((sorted[(LOW * LOW) / 2 - 1] ?? 0) + (sorted[(LOW * LOW) / 2] ?? 0)) / 2;
  const bits = coefficients.reduce((hash, c) => (hash << 1n) | (c > median ? 1n : 0n), 0n);
  return bits.toString(16).padStart(16, "0");
}

/** Bits that differ between two perceptual hashes. */
export function hammingDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

/** The same key, the same file, or a near-identical image. */
export function fingerprintsMatch(a: ProofFingerprint, b: ProofFingerprint): boolean {
  if (a.fieldsKey && a.fieldsKey === b.fieldsKey) return true;
  if (a.fileSha256 && a.fileSha256 === b.fileSha256) return true;
  return (
    a.perceptualHash !== undefined &&
    b.perceptualHash !== undefined &&
    hammingDistance(a.perceptualHash, b.perceptualHash) <= REUSE_MAX_HAMMING_BITS
  );
}

/** Other Testimonies in a place's fingerprints whose fingerprint matches this one. */
export function matchingTestimonyIds(
  fingerprint: ProofFingerprint,
  placeSnapshot: QuerySnapshot,
  testimonyId: string,
): string[] {
  return placeSnapshot.docs
    .filter((doc) => doc.id !== testimonyId && fingerprintsMatch(fingerprint, doc.data() as ProofFingerprintDoc))
    .map((doc) => doc.id);
}

/**
 * The reuse check inside the transaction that stores the proof result: reading the
 * place's fingerprints there means two Testimonies sent at once with one receipt cannot
 * both pass it.
 */
export async function reusedIn(
  tx: Transaction,
  firestore: Firestore,
  at: { testimonyId: string; placeId: string; fingerprint: ProofFingerprint },
): Promise<string[]> {
  const snapshot = await tx.get(placeFingerprints(firestore, at.placeId));
  return matchingTestimonyIds(at.fingerprint, snapshot, at.testimonyId);
}

/**
 * Keeps the fingerprint of an accepted or pending proof, replacing the Testimony's
 * previous one; a rejected proof keeps none.
 */
export function recordFingerprint(
  tx: Transaction,
  firestore: Firestore,
  at: { testimonyId: string; placeId: string; fingerprint: ProofFingerprint; now: Timestamp },
  result: ProofOfVisitRecord["result"],
): void {
  const ref = fingerprintRef(firestore, at.testimonyId);
  if (result === "rejected") {
    tx.delete(ref);
    return;
  }
  const doc: ProofFingerprintDoc = {
    testimonyId: at.testimonyId,
    placeId: at.placeId,
    ...at.fingerprint,
    createdAt: at.now,
  };
  tx.set(ref, doc);
}
