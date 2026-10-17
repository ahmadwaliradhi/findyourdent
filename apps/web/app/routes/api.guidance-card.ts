import { readShareToken } from "~/server/share.server";
import type { Route } from "./+types/api.guidance-card";

/** Longer than any token readShareToken would accept (it inflates to 64 KB at most). */
const MAX_TOKEN_LENGTH = 32 * 1024;

/**
 * POST /api/guidance-card with { token }: the Guidance in a signed share token, as
 * /panduan/:token reads it. The home page calls it after a reload to show the card
 * again; nothing is stored or looked up, and no Gemini call is made.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  }
  const body: unknown = await request.json().catch(() => null);
  const token = typeof body === "object" && body !== null ? (body as Record<string, unknown>).token : undefined;
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const guidance = readShareToken(token, context.config.shareLinkSecret);
  if (!guidance) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ guidance });
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
