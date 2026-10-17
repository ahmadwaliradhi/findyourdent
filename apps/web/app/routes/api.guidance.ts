import { requestGuidance } from "~/server/guidance.server";
import { getOrCreateSessionId } from "~/server/session.server";
import type { Route } from "./+types/api.guidance";

/**
 * Web API: POST /api/guidance with { complaintText, language, followUpQuestion?, followUpAnswer? }.
 * Returns the agent's GuidanceResponse (validated) or { error }.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  }
  const { sessionId, setCookie } = await getOrCreateSessionId(request);
  const headers = new Headers();
  if (setCookie) headers.append("Set-Cookie", setCookie);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers });
  }
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const outcome = await requestGuidance(context, {
    sessionId,
    language: input.language,
    complaintText: input.complaintText,
    followUpQuestion: input.followUpQuestion,
    followUpAnswer: input.followUpAnswer,
  });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status, headers });
  }
  return Response.json(outcome.response, { headers });
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
