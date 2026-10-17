import { redirect } from "react-router";
import { clearSession } from "../../server/auth.ts";
import type { Route } from "./+types/auth.signout";

/** POST /auth/signout: drops the sign-in from the session cookie and goes home. */
export async function action({ request }: Route.ActionArgs) {
  return redirect("/", { headers: { "Set-Cookie": await clearSession(request.headers.get("cookie")) } });
}

export function loader() {
  return redirect("/");
}
