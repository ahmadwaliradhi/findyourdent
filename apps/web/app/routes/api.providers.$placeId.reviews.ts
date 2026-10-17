import { googleRouteResponse, providerGoogleReviews } from "~/server/provider.server";
import type { Route } from "./+types/api.providers.$placeId.reviews";

/**
 * Web API: GET /api/providers/:placeId/reviews, only when the Patient taps
 * "Lihat ulasan Google". Returns a GoogleReviewsResponse.
 */
export function loader({ request, params, context }: Route.LoaderArgs) {
  return googleRouteResponse(context, request, params.placeId, (placeId, language) =>
    providerGoogleReviews(context, placeId, language),
  );
}
