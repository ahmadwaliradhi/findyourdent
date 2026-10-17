import { listingResponse } from "~/server/provider-picker.server";
import type { Route } from "./+types/api.providers.$placeId.listing";

/**
 * Web API: GET /api/providers/:placeId/listing. Returns a ProviderListingResponse:
 * the stored name and Region of a Listed Provider, or { listed: false }.
 */
export function loader({ params, context }: Route.LoaderArgs) {
  return listingResponse(context, params.placeId);
}
