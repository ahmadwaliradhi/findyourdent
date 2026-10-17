import { createCookie } from "react-router";
import { isLanguage, type Language } from "~/i18n/config";

/**
 * Everything the web service keeps in the browser, in one cookie. Firebase Hosting
 * strips every request cookie except `__session` before it reaches Cloud Run
 * (ADR-0008), so no other cookie name would survive.
 */
export interface BrowserState {
  /** Opaque Guidance session id (spec 01), not linked to any account. */
  sid?: string;
  /** Language toggle (spec 00). */
  lang?: Language;
}

const cookie = createCookie("__session", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
});

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function readBrowserState(request: Request): Promise<BrowserState> {
  const value: unknown = await cookie.parse(request.headers.get("cookie"));
  if (typeof value !== "object" || value === null) return {};
  const { sid, lang } = value as Record<string, unknown>;
  return {
    ...(typeof sid === "string" ? { sid } : {}),
    ...(isLanguage(lang) ? { lang } : {}),
  };
}

/**
 * Set-Cookie for the new state. A chosen language is remembered for a year; until
 * then the cookie only lives as long as the browser session.
 */
export function writeBrowserState(state: BrowserState): Promise<string> {
  return cookie.serialize(state, state.lang ? { maxAge: ONE_YEAR } : {});
}
