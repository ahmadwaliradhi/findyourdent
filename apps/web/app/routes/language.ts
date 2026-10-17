import { redirect } from "react-router";
import { isLanguage } from "~/i18n/config";
import { rememberLanguage } from "~/i18n/language.server";
import { safeRedirect } from "~/lib/safe-redirect";
import type { Route } from "./+types/language";

/** The language toggle posts here; works without JavaScript. */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const lang = form.get("lang");
  const to = safeRedirect(form.get("redirectTo"));
  if (!isLanguage(lang)) return redirect(to);
  return redirect(to, { headers: { "Set-Cookie": await rememberLanguage(request, lang) } });
}

export function loader() {
  return redirect("/");
}
