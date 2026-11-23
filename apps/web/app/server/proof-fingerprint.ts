// Proof Fingerprints (spec 09): what is kept of a proof after its file is deleted, and how
// two of them are compared for the reuse check. Pure apart from decoding the image.
import { createHash } from "node:crypto";
import type { ProofFingerprintDoc, ProofOfVisitExtracted } from "@findyourdent/contracts/firestore";
import sharp from "sharp";
import type { ReuseMatchKind } from "../lib/admin-queue.ts";
import { normalizeName } from "../lib/normalize-name.ts";

/**
 * Two image proofs whose perceptual hashes differ in at most this many of 64 bits are the
 * same picture (spec 09). Re-encoding and resizing one photo stays well under it; another
 * receipt, even on the same paper and layout, lands twenty or more bits away.
 */
export const REUSE_MAX_HAMMING_BITS = 10;

export type ProofFingerprint = Pick<ProofFingerprintDoc, "perceptualHash" | "fileSha256" | "fieldsKey">;

// pHash: the 8x8 lowest frequencies of a 32x32 DCT, each bit above or below their median.
// Low frequencies are the picture's layout, which re-encoding and resizing leave alone. A
// difference hash (dHash) was tried first: on a receipt's flat paper its bits flip with
// JPEG noise, and a rotated re-encode landed right on the threshold.
const SAMPLE_SIZE = 32;
const HASH_SIZE = 8;

/** COSINES[u][i]: the DCT-II basis, frequency u at sample i. */
const COSINES = Array.from({ length: HASH_SIZE }, (_, u) =>
  Array.from({ length: SAMPLE_SIZE }, (_, i) => Math.cos(((2 * i + 1) * u * Math.PI) / (2 * SAMPLE_SIZE))),
);

/** 64-bit perceptual hash of an image, as 16 lowercase hex chars. */
export async function perceptualHash(image: Buffer): Promise<string> {
  const pixels = await sharp(image)
    .rotate() // EXIF orientation, so a sideways phone photo hashes like the upright one
    .greyscale()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();
  const coefficients: number[] = [];
  for (let u = 0; u < HASH_SIZE; u++) {
    for (let v = 0; v < HASH_SIZE; v++) {
      let sum = 0;
      for (let y = 0; y < SAMPLE_SIZE; y++) {
        for (let x = 0; x < SAMPLE_SIZE; x++) {
          sum += (pixels[y * SAMPLE_SIZE + x] ?? 0) * (COSINES[u]?.[y] ?? 0) * (COSINES[v]?.[x] ?? 0);
        }
      }
      coefficients.push(sum);
    }
  }
  // The median leaves out the DC term (overall brightness), which would skew it.
  const ac = coefficients.slice(1).sort((a, b) => a - b);
  const median = ac[31] ?? 0; // the middle of the 63 values
  let hash = 0n;
  for (const c of coefficients) hash = (hash << 1n) | (c > median ? 1n : 0n);
  return hash.toString(16).padStart(16, "0");
}

/** SHA-256 of a file, lowercase hex. A PDF is compared byte for byte: re-saving one is rare. */
export function fileSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Differing bits between two 16-hex-char perceptual hashes. */
export function hammingDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (diff > 0n) {
    bits += Number(diff & 1n);
    diff >>= 1n;
  }
  return bits;
}

/**
 * The receipt's facts as one key, so the same receipt photographed twice still matches.
 * Absent unless the clinic name, date and total were all read: fewer facts are too common
 * to mean reuse.
 */
export function fieldsKey(extracted: ProofOfVisitExtracted | undefined): string | undefined {
  if (!extracted?.clinicName || !extracted.proofDate || extracted.totalRupiah === undefined) return undefined;
  return `${normalizeName(extracted.clinicName)}|${extracted.proofDate}|${extracted.totalRupiah}`;
}

/** A proof's fingerprint: a file hash for PDFs, a perceptual hash for images, plus the facts key. */
export async function fingerprintOf(
  file: { bytes: Buffer; mimeType: string },
  extracted: ProofOfVisitExtracted | undefined,
): Promise<ProofFingerprint> {
  const key = fieldsKey(extracted);
  const hash =
    file.mimeType === "application/pdf"
      ? { fileSha256: fileSha256(file.bytes) }
      : { perceptualHash: await perceptualHash(file.bytes) };
  return { ...hash, ...(key ? { fieldsKey: key } : {}) };
}

/** Every way two fingerprints match; empty when they do not. A field missing on either side never matches. */
export function fingerprintMatch(a: ProofFingerprint, b: ProofFingerprint): ReuseMatchKind[] {
  const kinds: ReuseMatchKind[] = [];
  if (a.fieldsKey && a.fieldsKey === b.fieldsKey) kinds.push("fieldsKey");
  if (a.fileSha256 && a.fileSha256 === b.fileSha256) kinds.push("fileHash");
  if (
    a.perceptualHash &&
    b.perceptualHash &&
    hammingDistance(a.perceptualHash, b.perceptualHash) <= REUSE_MAX_HAMMING_BITS
  ) {
    kinds.push("perceptualHash");
  }
  return kinds;
}
