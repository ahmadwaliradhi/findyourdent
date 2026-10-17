import { readBrowserState, writeBrowserState } from "./cookie.server";

const SESSION_ID = /^[A-Za-z0-9-]{8,128}$/;
/**
 * A remembered language keeps the __session cookie for a year, so the session id
 * carries its own lifetime: a new one after 12 hours.
 */
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Opaque Guidance session id (spec 01): random, short-lived and not linked to any account. */
export async function getOrCreateSessionId(request: Request): Promise<{ sessionId: string; setCookie: string | null }> {
  const state = await readBrowserState(request);
  const now = Date.now();
  if (state.sid && SESSION_ID.test(state.sid) && state.sidAt !== undefined && now - state.sidAt < SESSION_LIFETIME_MS) {
    return { sessionId: state.sid, setCookie: null };
  }
  const sessionId = crypto.randomUUID();
  return { sessionId, setCookie: await writeBrowserState({ ...state, sid: sessionId, sidAt: now }) };
}
