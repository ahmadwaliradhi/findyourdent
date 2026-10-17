import { saveOwnerFactsResponse } from "~/server/claims.server";
import type { Route } from "./+types/api.providers.$placeId.owner-facts";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/providers/:placeId/owner-facts with OwnerFactsSubmission, by the
 * approved claimant only. 200 OwnerContentResponse (published or held) or a ClaimApiError.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return saveOwnerFactsResponse(context, request, params.placeId);
}

export function loader() {
  return notAllowed();
}
