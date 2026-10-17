/** Stored photo object paths look like `testimonies/{testimonyId}/photos/{uuid}.jpg`. */
const PHOTO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|webp)$/;
const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * URL of a stored Testimony photo, served by GET /foto/:testimonyId/:photoId: to
 * anyone while the Testimony is published, and to its author in any state but deleted.
 */
export function testimonyPhotoUrl(testimonyId: string, path: string): string {
  const photoId = path.slice(path.lastIndexOf("/") + 1);
  return `/foto/${encodeURIComponent(testimonyId)}/${encodeURIComponent(photoId)}`;
}

/** The object path a photo URL's parts point to, or null when they are not a photo of that Testimony. */
export function testimonyPhotoPath(testimonyId: string, photoId: string): string | null {
  if (!TESTIMONY_ID.test(testimonyId) || !PHOTO_FILE.test(photoId)) return null;
  return `testimonies/${testimonyId}/photos/${photoId}`;
}
