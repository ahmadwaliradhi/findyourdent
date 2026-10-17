import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import type { AppLoadContext } from "react-router";
import type { Language } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import type { GoogleBlockResponse, GoogleReviewsResponse } from "~/lib/provider";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { getOrCreateSessionId } from "./session.server.ts";
import { inferProviderType, placeMapsUrl } from "./shortlist.server.ts";

/**
 * The Provider page's two Google routes (spec 02). The page itself renders only
 * FindYourDent content (provider-page.server.ts), so a crawler costs nothing; the
 * browser then asks these App Check-protected routes for the Google block and, on
 * a tap, Google Reviews. Google facts are passed through, never stored or logged.
 */

/** Google place ids are URL-safe base64-like strings; anything else never reaches Firestore or Places. */
const PLACE_ID = /^[A-Za-z0-9_-]{4,512}$/;

export function isPlaceId(value: string | undefined): value is string {
  return value !== undefined && PLACE_ID.test(value);
}

/** For the Maps link of a place with no first-party name; query_place_id does the finding. */
export const UNNAMED_MAPS_QUERY = "dokter gigi";

/**
 * wa.me link for an Indonesian mobile number ("0812-3456-7890", "+62 812…").
 * Landlines cannot take WhatsApp, so they get none.
 */
export function whatsappUri(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  const international = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return /^628\d{7,11}$/.test(international) ? `https://wa.me/${international}` : undefined;
}

async function readProvider(context: AppLoadContext, placeId: string): Promise<ProviderDoc | null> {
  if (!context.firestore) return null;
  const doc = await context.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return doc.exists ? (doc.data() as ProviderDoc) : null;
}

/** The Google block: one Place Details Enterprise call, or the fallback state with the Maps link. */
export async function providerGoogleBlock(
  context: AppLoadContext,
  placeId: string,
  language: Language,
): Promise<GoogleBlockResponse> {
  const [provider, result] = await Promise.all([
    readProvider(context, placeId),
    context.adapters.places.getGoogleBlock({ placeId, language }),
  ]);
  const fallbackMapsUri = placeMapsUrl(provider?.name ?? UNNAMED_MAPS_QUERY, placeId);
  context.logger.info("provider_google_block", { outcome: result.ok ? "ok" : result.reason });
  if (!result.ok) return { available: false, reason: result.reason, googleMapsUri: fallbackMapsUri };

  const { block } = result;
  const whatsapp = whatsappUri(block.nationalPhoneNumber);
  return {
    available: true,
    block: {
      displayName: block.displayName,
      providerType: provider?.providerType ?? inferProviderType(block),
      ...(block.formattedAddress ? { formattedAddress: block.formattedAddress } : {}),
      ...(block.openNow !== undefined ? { openNow: block.openNow } : {}),
      ...(block.weekdayHours ? { weekdayHours: block.weekdayHours } : {}),
      ...(block.nationalPhoneNumber ? { nationalPhoneNumber: block.nationalPhoneNumber } : {}),
      ...(whatsapp ? { whatsappUri: whatsapp } : {}),
      ...(block.websiteUri ? { websiteUri: block.websiteUri } : {}),
      ...(block.rating !== undefined ? { rating: block.rating } : {}),
      ...(block.userRatingCount !== undefined ? { userRatingCount: block.userRatingCount } : {}),
      googleMapsUri: block.googleMapsUri ?? fallbackMapsUri,
    },
  };
}

/** Google Reviews: the reviews-only Place Details call, made only when the Patient asks. */
export async function providerGoogleReviews(
  context: AppLoadContext,
  placeId: string,
  language: Language,
): Promise<GoogleReviewsResponse> {
  const result = await context.adapters.places.getGoogleReviews({ placeId, language });
  context.logger.info("provider_google_reviews", { outcome: result.ok ? "ok" : result.reason });
  return result.ok ? { available: true, reviews: result.reviews } : { available: false, reason: result.reason };
}

/**
 * GET handler shared by the two Google routes: App Check and the Places rate limits
 * first, so a crawler or a refused caller never reaches the adapter. Google content
 * must not be cached, so every answer past the gate is no-store.
 */
export async function googleRouteResponse(
  context: AppLoadContext,
  request: Request,
  placeId: string | undefined,
  answer: (placeId: string, language: Language) => Promise<GoogleBlockResponse | GoogleReviewsResponse>,
): Promise<Response> {
  const { sessionId, setCookie } = await getOrCreateSessionId(request);
  const protection = await protectPaidRequest(context, { request, route: "places", sessionId });
  if (!protection.ok) return protectionRefusalResponse(request, protection);

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  if (!isPlaceId(placeId)) return Response.json({ error: "not_found" }, { status: 404, headers });
  return Response.json(await answer(placeId, await detectLanguage(request)), { headers });
}
