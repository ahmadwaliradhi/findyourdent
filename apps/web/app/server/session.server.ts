import { createCookie } from "react-router";

/**
 * Opaque Guidance session id (spec 01): random, not linked to any account,
 * dropped when the browser session ends.
 */
const sessionCookie = createCookie("fyd_sid", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
});

const SESSION_ID = /^[A-Za-z0-9-]{8,128}$/;

export async function getOrCreateSessionId(request: Request): Promise<{ sessionId: string; setCookie: string | null }> {
  const existing: unknown = await sessionCookie.parse(request.headers.get("cookie"));
  if (typeof existing === "string" && SESSION_ID.test(existing)) {
    return { sessionId: existing, setCookie: null };
  }
  const sessionId = crypto.randomUUID();
  return { sessionId, setCookie: await sessionCookie.serialize(sessionId) };
}
