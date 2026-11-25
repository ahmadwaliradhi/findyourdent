import { saveViolationResponse } from "~/server/policy-violations-owner.server";
import type { Route } from "./+types/api.providers.$placeId.policy-violations.$violationId.response";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/providers/:placeId/policy-violations/:violationId/response with
 * ViolationResponseSubmission, by the approved claimant of that place only. Allowed
 * while the case is `providerNotified`; sending again replaces the earlier response.
 * 200 ViolationResponseResult or a ClaimApiError (400 invalid_response, 401, 403
 * not_owner, 404 not_found, 409 violation_closed).
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return saveViolationResponse(context, request, params.placeId, params.violationId);
}

export function loader() {
  return notAllowed();
}
