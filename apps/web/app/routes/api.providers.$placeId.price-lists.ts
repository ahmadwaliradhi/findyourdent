import { uploadPriceListResponse } from "~/server/price-lists.server";
import type { Route } from "./+types/api.providers.$placeId.price-lists";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/providers/:placeId/price-lists, multipart with `files` (one PDF or
 * one to five photos), by the approved claimant. 200 PriceListUploadResponse or a PriceListApiError.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return uploadPriceListResponse(context, request, params.placeId);
}

export function loader() {
  return notAllowed();
}
