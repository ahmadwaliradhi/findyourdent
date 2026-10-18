// Where a Proof of Visit file waits for the team, and for how long (spec 09). Shared by
// the web service and the proof expiry job (server/proof-expiry.ts), so it imports only
// what the Cloud Run job image has: relative files under server/ and the contracts.
import type { Bucket } from "./firebase.ts";

/**
 * A pending proof file is kept at most this many days. Keep in step with the
 * `proof-of-visit/` bucket lifecycle rule in infra/gcp/setup.sh.
 */
export const PROOF_RETENTION_DAYS = 7;

/** Where a Testimony's Proof of Visit files are kept until decided. */
export const proofPrefix = (testimonyId: string) => `proof-of-visit/${testimonyId}/`;

/** A stored proof is a PDF kept as sent, or an image re-encoded as JPEG (testimony-media.server.ts). */
export const isPdfProof = (path: string) => path.endsWith(".pdf");

/** Deletes one stored Proof of Visit file; a missing one is ignored. */
export async function deleteProofFile(uploads: Bucket, path: string): Promise<void> {
  await uploads.file(path).delete({ ignoreNotFound: true });
}

/**
 * Deletes every stored Proof of Visit file of a Testimony; missing ones are ignored. Only
 * for erasure: a decided proof deletes its own file (`filePath`), never a newer proof's.
 */
export async function deleteStoredProofs(uploads: Bucket, testimonyId: string): Promise<void> {
  const [files] = await uploads.getFiles({ prefix: proofPrefix(testimonyId) });
  await Promise.all(files.map((file) => deleteProofFile(uploads, file.name)));
}
