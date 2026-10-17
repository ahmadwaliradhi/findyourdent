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

/** Cookie first, then Accept-Language, then Indonesian. */
export async function detectLanguage(request: Request): Promise<Language> {
  const fromCookie: unknown = await languageCookie.parse(request.headers.get("cookie"));
  if (isLanguage(fromCookie)) return fromCookie;
  return fromAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LANGUAGE;
}

export function fromAcceptLanguage(header: string | null): Language | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    // "in" is the legacy ISO 639 code for Indonesian, still sent by some Android builds.
    if (primary === "id" || primary === "in") return "id";
    if (primary === "en") return "en";
  }
  return null;
}
