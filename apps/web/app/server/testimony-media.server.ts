// STUB (T11 seam): owned by the "form, photos and Proof upload" sub-agent.
import type { Bucket } from "../../server/firebase.ts";

/** Files taken from the multipart submit body, already checked for type, size and count. */
export interface TestimonyFiles {
  photos: File[];
  proof: File | null;
}

export type ParsedFiles = { ok: true; files: TestimonyFiles } | { ok: false; fieldErrors: Record<string, string> };

export interface StoredMedia {
  /** Object paths of the EXIF-stripped photos, in upload order. */
  photoPaths: string[];
  /** Object path of the private Proof of Visit, when one was sent. */
  proofPath?: string;
}

/** Reads `photos` and `proof` from the submit form data and validates them (count, type, size). */
export function readTestimonyFiles(_formData: FormData, _options: { existingPhotoCount: number }): ParsedFiles {
  throw new Error("not implemented");
}

/** Strips EXIF (and every other metadata block) and stores photos and Proof of Visit under the Testimony id. */
export async function storeTestimonyMedia(
  _uploads: Bucket,
  _testimonyId: string,
  _files: TestimonyFiles,
): Promise<StoredMedia> {
  throw new Error("not implemented");
}

/** Deletes stored objects; missing ones are ignored. */
export async function deleteTestimonyMedia(_uploads: Bucket, _paths: readonly string[]): Promise<void> {
  throw new Error("not implemented");
}
