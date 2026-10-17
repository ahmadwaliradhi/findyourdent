// Testimony photos and Proof of Visit (spec 03): checked on the way in, stored in the
// private uploads bucket with every metadata block (EXIF GPS included) stripped.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { DEFAULT_LANGUAGE, getI18n, type Language } from "~/i18n/config";
import { PHOTO_MIME_TYPES, PROOF_MIME_TYPES, SUBMISSION_FIELDS, TESTIMONY_LIMITS } from "~/lib/testimony";
import type { Bucket } from "../../server/firebase.ts";

/** Files taken from the multipart submit body, already checked for type, size and count. */
export interface TestimonyFiles {
  /** `type` is the sniffed type, not the one the browser declared. */
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

/** Longest edge of a stored photo; phone photos are far bigger than a card needs. */
export const PHOTO_MAX_EDGE_PX = 1600;
/** A receipt must stay readable for the Proof of Visit check. */
const PROOF_MAX_EDGE_PX = 2400;

type SniffedType = (typeof PROOF_MIME_TYPES)[number];

/** The real type from the first bytes, whatever the browser declared. */
async function sniffType(file: File): Promise<SniffedType | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && ascii(1, 8) === "PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function includes<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value);
}

/** Whether sharp can decode the image at all, so a truncated file fails here rather than at storage. */
async function decodes(file: File): Promise<boolean> {
  try {
    await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "error" }).stats();
    return true;
  } catch {
    return false;
  }
}

/** Empty file inputs (nothing picked) arrive as a nameless zero-byte file. */
function pickedFiles(formData: FormData, field: string): File[] | "notFiles" {
  const values = formData.getAll(field);
  if (values.some((value) => typeof value === "string")) return "notFiles";
  return (values as File[]).filter((file) => file.size > 0);
}

/**
 * Reads `photos` and `proof` from the submit form data and validates them (count, type, size).
 * Async: the file bytes are sniffed, so a mislabelled file is refused. Always `await` it.
 */
export async function readTestimonyFiles(
  formData: FormData,
  options: { existingPhotoCount: number; language?: Language },
): Promise<ParsedFiles> {
  const language = options.language ?? DEFAULT_LANGUAGE;
  const t = getI18n(language).getFixedT(language);
  const fieldErrors: Record<string, string> = {};

  const photosMax = Math.max(0, TESTIMONY_LIMITS.photosMax - options.existingPhotoCount);
  const photos: File[] = [];
  const pickedPhotos = pickedFiles(formData, SUBMISSION_FIELDS.photos);
  if (pickedPhotos === "notFiles") {
    fieldErrors.photos = t("testimonyForm.fileErrors.photoType");
  } else if (pickedPhotos.length > photosMax) {
    fieldErrors.photos = t("testimonyForm.fileErrors.photoCount", { max: TESTIMONY_LIMITS.photosMax });
  } else {
    for (const photo of pickedPhotos) {
      if (photo.size > TESTIMONY_LIMITS.photoMaxBytes) {
        fieldErrors.photos = t("testimonyForm.fileErrors.photoSize", { mb: megabytes("photo") });
        break;
      }
      const type = await sniffType(photo);
      if (!includes(PHOTO_MIME_TYPES, photo.type) || !includes(PHOTO_MIME_TYPES, type) || !(await decodes(photo))) {
        fieldErrors.photos = t("testimonyForm.fileErrors.photoType");
        break;
      }
      photos.push(new File([photo], photo.name, { type }));
    }
  }

  let proof: File | null = null;
  const pickedProof = pickedFiles(formData, SUBMISSION_FIELDS.proof);
  if (pickedProof === "notFiles" || pickedProof.length > 1) {
    fieldErrors.proof = t("testimonyForm.fileErrors.proofType");
  } else if (pickedProof[0]) {
    const file = pickedProof[0];
    const type = await sniffType(file);
    if (file.size > TESTIMONY_LIMITS.proofMaxBytes) {
      fieldErrors.proof = t("testimonyForm.fileErrors.proofSize", { mb: megabytes("proof") });
    } else if (
      !includes(PROOF_MIME_TYPES, file.type) ||
      !includes(PROOF_MIME_TYPES, type) ||
      (type !== "application/pdf" && !(await decodes(file)))
    ) {
      fieldErrors.proof = t("testimonyForm.fileErrors.proofType");
    } else {
      proof = new File([file], file.name, { type });
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, files: { photos, proof } };
}

function megabytes(kind: "photo" | "proof"): number {
  const bytes = kind === "photo" ? TESTIMONY_LIMITS.photoMaxBytes : TESTIMONY_LIMITS.proofMaxBytes;
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Re-encodes an image as JPEG: applies the EXIF orientation first, then writes no
 * metadata at all (sharp drops EXIF, XMP, IPTC and ICC unless asked to keep them).
 */
async function strippedJpeg(file: File, maxEdge: number): Promise<Buffer> {
  return sharp(Buffer.from(await file.arrayBuffer()), { failOn: "error" })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/** Objects stay private: the bucket prevents public access and nothing here grants it. */
async function save(uploads: Bucket, path: string, body: Buffer, contentType: string): Promise<void> {
  await uploads.file(path).save(body, { contentType, resumable: false, metadata: { cacheControl: "private" } });
}

/**
 * Stores photos at `testimonies/{testimonyId}/photos/{uuid}.jpg` (EXIF and every other
 * metadata block stripped, re-encoded as JPEG, longest edge at most 1600 px) and the
 * Proof of Visit at `proof-of-visit/{testimonyId}/{uuid}.{jpg|pdf}` (images stripped the
 * same way, PDFs as sent). If any write fails, what was already written is deleted.
 */
export async function storeTestimonyMedia(
  uploads: Bucket,
  testimonyId: string,
  files: TestimonyFiles,
): Promise<StoredMedia> {
  const written: string[] = [];
  try {
    const photoPaths: string[] = [];
    for (const photo of files.photos) {
      const path = `testimonies/${testimonyId}/photos/${randomUUID()}.jpg`;
      await save(uploads, path, await strippedJpeg(photo, PHOTO_MAX_EDGE_PX), "image/jpeg");
      written.push(path);
      photoPaths.push(path);
    }
    if (!files.proof) return { photoPaths };

    const pdf = files.proof.type === "application/pdf";
    const proofPath = `proof-of-visit/${testimonyId}/${randomUUID()}.${pdf ? "pdf" : "jpg"}`;
    const body = pdf
      ? Buffer.from(await files.proof.arrayBuffer())
      : await strippedJpeg(files.proof, PROOF_MAX_EDGE_PX);
    await save(uploads, proofPath, body, pdf ? "application/pdf" : "image/jpeg");
    return { photoPaths, proofPath };
  } catch (error) {
    await deleteTestimonyMedia(uploads, written).catch(() => {});
    throw error;
  }
}

/** Deletes stored objects; missing ones are ignored. */
export async function deleteTestimonyMedia(uploads: Bucket, paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => uploads.file(path).delete({ ignoreNotFound: true })));
}
