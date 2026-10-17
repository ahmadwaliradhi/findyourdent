import { googleRouteResponse, providerGoogleBlock } from "~/server/provider.server";
import type { Route } from "./+types/api.providers.$placeId.google";

/**
 * Web API: GET /api/providers/:placeId/google, asked for by the Provider page after it
 * renders. Returns a GoogleBlockResponse: the live Google block, or its fallback state.
 */
export function loader({ request, params, context }: Route.LoaderArgs) {
  return googleRouteResponse(context, request, params.placeId, (placeId, language) =>
    providerGoogleBlock(context, placeId, language),
  );
}
