// Browser side of the owner's writes (Claims, owner facts, replies, Price Lists).
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import type { useFirebaseConfig } from "~/lib/firebase-config";

/** POST helper: the App Check token rides along on every owner write. */
export async function sendOwnerRequest(
  firebase: ReturnType<typeof useFirebaseConfig>,
  url: string,
  body: FormData | object,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string | null }> {
  try {
    const token = await getAppCheckToken(firebase);
    const json = !(body instanceof FormData);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(json ? { "content-type": "application/json" } : {}),
        ...(token ? { [APP_CHECK_HEADER]: token } : {}),
      },
      body: json ? JSON.stringify(body) : body,
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, body: parsed };
    return { ok: false, message: (parsed as { message?: string } | null)?.message ?? null };
  } catch {
    return { ok: false, message: null };
  }
}
