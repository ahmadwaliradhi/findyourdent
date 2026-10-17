import { detectLanguage } from "~/i18n/language.server";
import { protectionRefusalResponse, protectPaidRequest } from "~/server/protection.server";
import { getOrCreateSessionId } from "~/server/session.server";
import { buildShortlist } from "~/server/shortlist.server";
import type { Route } from "./+types/api.shortlist";

/**
 * Web API: POST /api/shortlist with { purpose: "shortlist", guidanceToken, location | area }
 * or { purpose: "emergency", location | area }. Returns a ShortlistResponse or { error }.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  }
  const { sessionId, setCookie } = await getOrCreateSessionId(request);
  const headers = new Headers();
  if (setCookie) headers.append("Set-Cookie", setCookie);

  const protection = await protectPaidRequest(context, { request, route: "places", sessionId });
  if (!protection.ok) return protectionRefusalResponse(request, protection);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const outcome = await buildShortlist(context, { body, language: await detectLanguage(request), sessionId });
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status, headers });
  return Response.json(outcome.response, { headers });
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
