import { REGIONS } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  type PriceListDoc,
  type ProcedureCode,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import type { AppLoadContext } from "react-router";
import type { Language } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import type {
  GoogleBlockResponse,
  GoogleReviewsResponse,
  OwnerFacts,
  ProviderPageData,
  PublicTestimony,
} from "~/lib/provider";
import type { PriceSignal } from "~/lib/shortlist";
import { jakartaDate } from "../../server/quota.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { getOrCreateSessionId } from "./session.server.ts";
import { inferProviderType, placeMapsUrl } from "./shortlist.server.ts";

/**
 * Provider page (spec 02). The loader renders FindYourDent's own content from
 * Firestore and never calls Places, so a crawler costs nothing; the browser then
 * asks the two App Check-protected routes for the Google block and, on a tap,
 * Google Reviews. Google facts are passed through, never stored or logged.
 */

/** Google place ids are URL-safe base64-like strings; anything else never reaches Firestore or Places. */
const PLACE_ID = /^[A-Za-z0-9_-]{4,512}$/;

export function isPlaceId(value: string | undefined): value is string {
  return value !== undefined && PLACE_ID.test(value);
}

/** A median price paid is shown only with at least this many Testimony prices (spec 02). */
const MIN_PRICES_FOR_MEDIAN = 2;
const TESTIMONY_LIMIT = 50;
/** For the Maps link of a place with no first-party name; query_place_id does the finding. */
const UNNAMED_MAPS_QUERY = "dokter gigi";

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

function regionName(provider: ProviderDoc): string | undefined {
  const regency = REGIONS.regencies.find((r) => r.code === provider.region.regencyCode);
  const province = REGIONS.provinces.find((p) => p.code === provider.region.provinceCode);
  const parts = [regency?.name, province?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function toPublicTestimony(id: string, doc: TestimonyDoc): PublicTestimony {
  return {
    id,
    displayName: doc.displayName,
    ratings: doc.ratings,
    text: doc.text,
    visitMonth: doc.visitMonth,
    ...(doc.procedureCode ? { procedureCode: doc.procedureCode } : {}),
    ...(doc.pricePaidRupiah !== undefined ? { pricePaidRupiah: doc.pricePaidRupiah } : {}),
    verifiedVisit: doc.verifiedVisit,
    ...(doc.reply?.status === "published" ? { reply: doc.reply.text } : {}),
  };
}

function ownerFacts(provider: ProviderDoc): OwnerFacts | undefined {
  const facts = provider.ownerFacts;
  if (provider.claimStatus !== "claimed" || facts?.moderationStatus !== "published") return undefined;
  const whatsapp = whatsappUri(facts.whatsapp);
  return {
    ...(facts.address ? { address: facts.address } : {}),
    ...(facts.phone ? { phone: facts.phone } : {}),
    ...(whatsapp ? { whatsappUri: whatsapp } : {}),
    ...(facts.website ? { website: facts.website } : {}),
    ...(facts.openingHours ? { openingHours: facts.openingHours } : {}),
  };
}

/** Without a Guidance there is no Cost Estimate: median price paid, then the Price List, per procedure. */
function priceSignals(provider: ProviderDoc, priceList: PriceListDoc | undefined): PriceSignal[] {
  const signals: PriceSignal[] = [];
  for (const [code, paid] of Object.entries(provider.aggregates.procedurePrices)) {
    if (paid.count < MIN_PRICES_FOR_MEDIAN) continue;
    signals.push({
      procedureCode: code as ProcedureCode,
      source: "testimonies",
      minRupiah: paid.medianRupiah,
      maxRupiah: paid.medianRupiah,
      asOf: jakartaDate(provider.updatedAt.toMillis()),
    });
  }
  for (const row of priceList?.rows ?? []) {
    if (!row.procedureCode) continue;
    signals.push({
      procedureCode: row.procedureCode,
      source: "priceList",
      minRupiah: row.minRupiah,
      maxRupiah: row.maxRupiah,
      asOf: jakartaDate(priceList?.confirmedAt.toMillis() ?? 0),
    });
  }
  return signals;
}

async function readProvider(context: AppLoadContext, placeId: string): Promise<ProviderDoc | null> {
  if (!context.firestore) return null;
  const doc = await context.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return doc.exists ? (doc.data() as ProviderDoc) : null;
}

/** The server-rendered part of the page. Makes no Places call. */
export async function loadProviderPage(context: AppLoadContext, placeId: string): Promise<ProviderPageData> {
  const provider = await readProvider(context, placeId);
  if (!provider || !context.firestore) {
    return {
      placeId,
      listed: false,
      claimed: false,
      testimonies: { count: 0, verifiedVisitCount: 0 },
      testimonyList: [],
      priceSignals: [],
      googleMapsUri: placeMapsUrl(UNNAMED_MAPS_QUERY, placeId),
    };
  }

  const { firestore } = context;
  // Equality filters only, so no composite index is needed; newest first in memory.
  const [testimonySnapshot, priceListSnapshot] = await Promise.all([
    firestore
      .collection(COLLECTIONS.testimonies)
      .where("placeId", "==", placeId)
      .where("status", "==", "published")
      .limit(TESTIMONY_LIMIT)
      .get(),
    provider.claimStatus === "claimed"
      ? firestore
          .collection(COLLECTIONS.priceLists)
          .where("placeId", "==", placeId)
          .where("status", "==", "current")
          .limit(1)
          .get()
      : null,
  ]);
  const testimonies = testimonySnapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as TestimonyDoc }))
    .sort((a, b) => (b.data.publishedAt?.toMillis() ?? 0) - (a.data.publishedAt?.toMillis() ?? 0))
    .map(({ id, data }) => toPublicTestimony(id, data));
  const priceList = priceListSnapshot?.docs[0]?.data() as PriceListDoc | undefined;
  const { testimonyCount, verifiedVisitCount, averages } = provider.aggregates;
  const owner = ownerFacts(provider);
  const region = regionName(provider);

  return {
    placeId,
    listed: true,
    name: provider.name,
    ...(region ? { regionName: region } : {}),
    providerType: provider.providerType,
    providerTypeSource: provider.providerTypeSource,
    claimed: provider.claimStatus === "claimed",
    testimonies: { count: testimonyCount, verifiedVisitCount, ...(averages ? { averages } : {}) },
    testimonyList: testimonies,
    priceSignals: priceSignals(provider, priceList),
    ...(owner ? { owner } : {}),
    googleMapsUri: placeMapsUrl(provider.name, placeId),
  };
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
