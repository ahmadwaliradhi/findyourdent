import { submitClaimResponse } from "~/server/claims.server";
import type { Route } from "./+types/api.providers.$placeId.claims";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/providers/:placeId/claims, multipart with a `claim` JSON part
 * (ClaimSubmission) and one `permit` file, signed in. 201 ClaimSubmitResponse or a ClaimApiError.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return submitClaimResponse(context, request, params.placeId);
}

export function loader() {
  return notAllowed();
}
