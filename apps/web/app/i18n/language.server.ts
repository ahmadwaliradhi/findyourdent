import { readBrowserState, updateBrowserState } from "../../server/browser-state.ts";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./config";

/**
 * Toggle cookie, else Indonesian. Accept-Language is deliberately ignored: many
 * Indonesian phones run an English system locale, and spec 00 makes Indonesian the default.
 */
export async function detectLanguage(request: Request): Promise<Language> {
  const { lang } = await readBrowserState(request.headers.get("cookie"));
  return isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
}

/** Set-Cookie that remembers the toggle per browser, keeping the sign-in and Guidance session. */
export function rememberLanguage(request: Request, lang: Language): Promise<string> {
  return updateBrowserState(request.headers.get("cookie"), { lang });
}
