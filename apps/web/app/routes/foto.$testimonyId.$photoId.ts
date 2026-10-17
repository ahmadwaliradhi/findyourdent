import { COLLECTIONS, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { testimonyPhotoPath } from "~/lib/testimony-photos";
import { readSession } from "../../server/auth.ts";
import type { Route } from "./+types/foto.$testimonyId.$photoId";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * A stored Testimony photo (the uploads bucket is private, so photos go through here).
 * Public while the Testimony is published and the photo is in its public version; its
 * author also sees their own photos in any state but deleted (for 'Testimoni saya' and
 * editing). Everything else is a 404, so nothing reveals that a Testimony exists.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const path = testimonyPhotoPath(params.testimonyId, params.photoId);
  if (!path || !context.firestore || !context.uploads) return notFound();
  const snapshot = await context.firestore.collection(COLLECTIONS.testimonies).doc(params.testimonyId).get();
  const testimony = snapshot.data() as TestimonyDoc | undefined;
  if (!testimony) return notFound();

  let cacheControl: string;
  if (testimony.status === "published" && testimony.photoPaths.includes(path)) {
    // Short, so a photo stops showing soon after the Testimony is hidden or deleted.
    cacheControl = "public, max-age=600";
  } else {
    const user = await readSession(context.auth, request.headers.get("cookie"));
    const ownPhotos = [...testimony.photoPaths, ...(testimony.pendingRevision?.photoPaths ?? [])];
    if (!user || user.uid !== testimony.authorUid || testimony.status === "deleted" || !ownPhotos.includes(path)) {
      return notFound();
    }
    cacheControl = "private, no-store";
  }

  const file = context.uploads.file(path);
  let bytes: Buffer;
  try {
    [bytes] = await file.download();
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": path.endsWith(".webp") ? "image/webp" : "image/jpeg",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
