import { confirmPriceListResponse } from "~/server/price-lists.server";
import type { Route } from "./+types/api.providers.$placeId.price-lists.$priceListId";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/providers/:placeId/price-lists/:priceListId, JSON PriceListConfirmation,
 * by the approved claimant. 200 PriceListConfirmResponse or a PriceListApiError.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return confirmPriceListResponse(context, request, params.placeId, params.priceListId);
}

export function loader() {
  return notAllowed();
}
