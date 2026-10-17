import { createSession } from "../../server/auth.ts";
import type { Route } from "./+types/auth.session";

/**
 * POST /auth/session with { idToken } from a Google sign-in in the browser.
 * Sets the `__session` cookie. JSON only, so another site cannot post a form here.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "invalid_request" }, { status: 415 });
  }
  if (!context.auth) return Response.json({ error: "auth_unavailable" }, { status: 503 });

  let idToken: unknown;
  try {
    idToken = ((await request.json()) as { idToken?: unknown } | null)?.idToken;
  } catch {
    idToken = undefined;
  }
  if (typeof idToken !== "string" || idToken === "") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const outcome = await createSession(context.auth, idToken, request.headers.get("cookie"));
  if (!outcome.ok) {
    context.logger.warn("signin", { outcome: outcome.error });
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  context.logger.info("signin", { outcome: "ok" });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": outcome.setCookie } });
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
