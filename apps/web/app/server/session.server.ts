import { readBrowserState, updateBrowserState } from "../../server/browser-state.ts";

const SESSION_ID = /^[A-Za-z0-9-]{8,128}$/;
/**
 * A remembered language or a sign-in keeps the `__session` cookie for a year, so the
 * session id carries its own lifetime: a new one after 12 hours.
 */
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Opaque Guidance session id (spec 01): random, short-lived and not linked to any account. */
export async function getOrCreateSessionId(request: Request): Promise<{ sessionId: string; setCookie: string | null }> {
  const cookieHeader = request.headers.get("cookie");
  const { sid, sidAt } = await readBrowserState(cookieHeader);
  const now = Date.now();
  if (sid && SESSION_ID.test(sid) && sidAt !== undefined && now - sidAt < SESSION_LIFETIME_MS) {
    return { sessionId: sid, setCookie: null };
  }
  const sessionId = crypto.randomUUID();
  return { sessionId, setCookie: await updateBrowserState(cookieHeader, { sid: sessionId, sidAt: now }) };
}
