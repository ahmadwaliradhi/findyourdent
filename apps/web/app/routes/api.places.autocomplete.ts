import { autocompleteResponse } from "~/server/provider-picker.server";
import type { Route } from "./+types/api.places.autocomplete";

/**
 * Web API: GET /api/places/autocomplete?input=&sessionToken=[&lat=&lng=], the
 * Testimony provider picker. Returns an AutocompleteResponse.
 */
export function loader({ request, context }: Route.LoaderArgs) {
  return autocompleteResponse(context, request);
}
