import { createCookie } from "react-router";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./config";

/** Remembers the toggle per browser for a year. */
export const languageCookie = createCookie("lang", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
});

/**
 * Toggle cookie, else Indonesian. Accept-Language is deliberately ignored: many
 * Indonesian phones run an English system locale, and spec 00 makes Indonesian the default.
 */
export async function detectLanguage(request: Request): Promise<Language> {
  const fromCookie: unknown = await languageCookie.parse(request.headers.get("cookie"));
  return isLanguage(fromCookie) ? fromCookie : DEFAULT_LANGUAGE;
}
