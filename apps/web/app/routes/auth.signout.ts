import { redirect } from "react-router";
import { clearSession } from "../../server/auth.ts";

/** POST /auth/signout: drops the session cookie and goes home. */
export async function action() {
  return redirect("/", { headers: { "Set-Cookie": await clearSession() } });
}

export function loader() {
  return redirect("/");
}
