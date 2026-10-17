import { readBrowserState, writeBrowserState } from "~/server/cookie.server";
import { DEFAULT_LANGUAGE, type Language } from "./config";

/**
 * Toggle cookie, else Indonesian. Accept-Language is deliberately ignored: many
 * Indonesian phones run an English system locale, and spec 00 makes Indonesian the default.
 */
export async function detectLanguage(request: Request): Promise<Language> {
  return (await readBrowserState(request)).lang ?? DEFAULT_LANGUAGE;
}

/** Set-Cookie that remembers the toggle per browser, keeping the Guidance session id. */
export async function rememberLanguage(request: Request, lang: Language): Promise<string> {
  return writeBrowserState({ ...(await readBrowserState(request)), lang });
}
