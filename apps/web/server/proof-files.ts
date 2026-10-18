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

/** Every stored Proof of Visit file of a Testimony: a pending one waits there for an admin. */
export async function storedProofPaths(uploads: Bucket, testimonyId: string): Promise<string[]> {
  const [files] = await uploads.getFiles({ prefix: proofPrefix(testimonyId) });
  return files.map((file) => file.name);
}

/** Deletes every stored Proof of Visit file of a Testimony; missing ones are ignored. */
export async function deleteStoredProofs(uploads: Bucket, testimonyId: string): Promise<void> {
  const paths = await storedProofPaths(uploads, testimonyId);
  await Promise.all(paths.map((path) => uploads.file(path).delete({ ignoreNotFound: true })));
}
