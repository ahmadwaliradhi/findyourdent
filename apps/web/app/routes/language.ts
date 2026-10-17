import { redirect } from "react-router";
import { isLanguage } from "~/i18n/config";
import { languageCookie } from "~/i18n/language.server";
import type { Route } from "./+types/language";

function safeRedirect(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

/** The language toggle posts here; works without JavaScript. */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const lang = form.get("lang");
  const to = safeRedirect(form.get("redirectTo"));
  if (!isLanguage(lang)) return redirect(to);
  return redirect(to, { headers: { "Set-Cookie": await languageCookie.serialize(lang) } });
}

export function loader() {
  return redirect("/");
}
