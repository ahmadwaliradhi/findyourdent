import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import type { PublicFirebaseConfig } from "~/lib/firebase-config";

/** GET one of the Provider's Google routes with this browser's App Check token. */
export async function fetchGoogleRoute<T>(
  firebase: PublicFirebaseConfig,
  placeId: string,
  part: "google" | "reviews",
): Promise<T> {
  const token = await getAppCheckToken(firebase).catch(() => "");
  const response = await fetch(`/api/providers/${encodeURIComponent(placeId)}/${part}`, {
    headers: { [APP_CHECK_HEADER]: token },
  });
  if (!response.ok) throw new Error(`${part} ${response.status}`);
  return (await response.json()) as T;
}
