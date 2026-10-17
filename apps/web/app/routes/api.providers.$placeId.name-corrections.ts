import { nameCorrectionResponse } from "~/server/provider-picker.server";
import type { Route } from "./+types/api.providers.$placeId.name-corrections";

/**
 * Web API: POST /api/providers/:placeId/name-corrections with a NameCorrectionRequest
 * ("Sarankan koreksi"), signed in. Returns 201 { id } or a TestimonyApiError-shaped body.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  }
  return nameCorrectionResponse(context, request, params.placeId);
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
