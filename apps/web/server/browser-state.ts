import { randomBytes } from "node:crypto";
import { createCookie } from "react-router";

/**
 * Everything the web service keeps in the browser, in one cookie. Firebase Hosting
 * strips every request cookie except `__session` before it reaches Cloud Run, so
 * no other cookie name would survive. Any new cookie value belongs here too, or it
 * works locally and breaks once deployed.
 */
export interface BrowserState {
  /** Opaque Guidance session id (spec 01), not linked to any account. */
  sid?: string;
  /** When sid was issued (ms since epoch); it expires on its own, not with the cookie. */
  sidAt?: number;
  /** Language toggle (spec 00), validated by the caller. */
  lang?: string;
  /** Firebase session cookie from a Google sign-in; Firebase checks its own expiry. */
  auth?: string;
  /**
   * Opaque random id of this browser, not of any account: it survives sign-out and a
   * change of account, which is how detection (spec 09 part 2, D3) sees one device
   * behind two accounts. Only its salted hash is ever stored.
   */
  bid?: string;
}

/** A new opaque browser id. */
export const newBrowserId = (): string => randomBytes(18).toString("base64url");

const cookie = createCookie("__session", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
});

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function readBrowserState(cookieHeader: string | null | undefined): Promise<BrowserState> {
  const value: unknown = await cookie.parse(cookieHeader ?? null);
  if (typeof value !== "object" || value === null) return {};
  const { sid, sidAt, lang, auth, bid } = value as Record<string, unknown>;
  return {
    ...(typeof sid === "string" ? { sid } : {}),
    ...(typeof sidAt === "number" ? { sidAt } : {}),
    ...(typeof lang === "string" ? { lang } : {}),
    ...(typeof auth === "string" && auth !== "" ? { auth } : {}),
    ...(typeof bid === "string" && bid !== "" ? { bid } : {}),
  };
}

/**
 * Set-Cookie for the new state. A chosen language, a sign-in or a browser id keeps the
 * cookie for a year; otherwise it lives as long as the browser session. Empty state deletes it.
 */
export function writeBrowserState(state: BrowserState): Promise<string> {
  if (Object.keys(state).length === 0) return cookie.serialize("", { maxAge: 0 });
  return cookie.serialize(state, state.lang || state.auth || state.bid ? { maxAge: ONE_YEAR } : {});
}

/** Set-Cookie that applies `change` to the request's state and keeps the rest. */
export async function updateBrowserState(
  cookieHeader: string | null | undefined,
  change: Partial<BrowserState>,
): Promise<string> {
  const next: Record<string, unknown> = { ...(await readBrowserState(cookieHeader)), ...change };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return writeBrowserState(next as BrowserState);
}
