import { readBrowserState, writeBrowserState } from "./cookie.server";

const SESSION_ID = /^[A-Za-z0-9-]{8,128}$/;

/** Opaque Guidance session id (spec 01): random and not linked to any account. */
export async function getOrCreateSessionId(request: Request): Promise<{ sessionId: string; setCookie: string | null }> {
  const state = await readBrowserState(request);
  if (state.sid && SESSION_ID.test(state.sid)) {
    return { sessionId: state.sid, setCookie: null };
  }
  const sessionId = crypto.randomUUID();
  return { sessionId, setCookie: await writeBrowserState({ ...state, sid: sessionId }) };
}
