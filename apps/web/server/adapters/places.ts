/**
 * The one Places adapter (spec 02, ADR-0005). Every Places call goes through here,
 * under a named method with an explicit field mask, and is counted against that
 * method's daily cap. Nothing it returns is stored except `placeId` (and, elsewhere,
 * dated coordinates); callers keep the rest in memory.
 */
import type { PlacesMethod } from "@findyourdent/contracts/firestore";
import type { Language } from "../../app/i18n/config.ts";
import type { DailyQuota } from "../quota.ts";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TextSearch {
  /**
   * `shortlist`: a Guidance Shortlist. `emergency`: nearby Hospitals with an IGD for
   * the emergency card; shares the Shortlist search cap and is served first.
   */
  purpose: "shortlist" | "emergency";
  textQuery: string;
  includedType: "dentist" | "hospital";
  /** With a shared location; a typed area travels in `textQuery` instead. */
  locationBias?: { center: LatLng; radiusMeters: number };
  language: Language;
}

/** Live Google facts for one place. Shown, never stored (except placeId). */
export interface PlaceSummary {
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  location?: LatLng;
  types: string[];
  googleMapsUri?: string;
}

export type TextSearchResult =
  | { ok: true; places: PlaceSummary[] }
  /** cap_reached: our daily cap or Google's RESOURCE_EXHAUSTED; unavailable: any other failure. */
  | { ok: false; reason: "cap_reached" | "unavailable" };

/** A Place Details call for one Provider page. */
export interface PlaceDetailsRequest {
  placeId: string;
  language: Language;
}

/** Live Google facts for the Provider page's Google block. Shown, never stored. */
export interface GoogleBlock {
  placeId: string;
  displayName: string;
  /** For the Provider type inference rule when the Provider is not Listed (spec 02). */
  types: string[];
  formattedAddress?: string;
  openNow?: boolean;
  /** Google's own localized lines, one per day ("Senin: 09.00–21.00"). */
  weekdayHours?: string[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

/** One Google review, with the author attribution Google requires us to show. */
export interface GoogleReview {
  rating?: number;
  text?: string;
  /** Google's localized "2 minggu lalu". */
  relativeTime?: string;
  publishTime?: string;
  author: { name: string; uri?: string; photoUri?: string };
  googleMapsUri?: string;
}

/** cap_reached: our daily cap or Google's RESOURCE_EXHAUSTED; not_found: Google has no such place. */
export type PlaceDetailsFailure = { ok: false; reason: "cap_reached" | "not_found" | "unavailable" };

export type GoogleBlockResult = { ok: true; block: GoogleBlock } | PlaceDetailsFailure;
export type GoogleReviewsResult = { ok: true; reviews: GoogleReview[] } | PlaceDetailsFailure;

export interface PlacesAdapter {
  searchText(search: TextSearch): Promise<TextSearchResult>;
  /** Place Details, Enterprise tier: one call per Provider page view, asked for by the browser. */
  getGoogleBlock(request: PlaceDetailsRequest): Promise<GoogleBlockResult>;
  /** Place Details with only the reviews field: only when the Patient taps "Lihat ulasan Google". */
  getGoogleReviews(request: PlaceDetailsRequest): Promise<GoogleReviewsResult>;
}

/** Text Search (New) at the Pro tier: no rating, opening hours or phone (spec 02). */
export const SHORTLIST_SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.googleMapsUri",
].join(",");

/**
 * Place Details, Enterprise tier (spec 02). `displayName` and `types` (Pro and
 * Essentials, billed under the same Enterprise SKU) give a non-Listed Provider its
 * heading and its inferred type.
 */
export const PROVIDER_GOOGLE_BLOCK_FIELD_MASK = [
  "displayName",
  "types",
  "formattedAddress",
  "regularOpeningHours",
  "nationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "googleMapsUri",
].join(",");

/** Place Details with the reviews field only (Enterprise and Atmosphere tier). */
export const GOOGLE_REVIEWS_FIELD_MASK = "reviews";

/**
 * Adapter-side daily cap for Text Search (spec 02), matching the project quota
 * `SearchTextRequestPerDayPerProject` in infra/gcp/README.md.
 */
export const SHORTLIST_SEARCH_DAILY_CAP = 160;

/**
 * Shortlist searches stop this many short of the cap, so emergency Hospital searches
 * (which share it) are served first: about one in eight of the day's searches.
 */
export const EMERGENCY_RESERVE = 20;

/**
 * Google caps Place Details per method, not per SKU: one project cap of 83 a day
 * (infra/gcp/README.md) is shared, so only these counters keep the 50/33 split.
 */
export const PROVIDER_GOOGLE_BLOCK_DAILY_CAP = 50;
export const GOOGLE_REVIEWS_DAILY_CAP = 33;

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/";
const PAGE_SIZE = 20;

export interface GooglePlacesAdapterOptions {
  apiKey: string;
  quota: DailyQuota;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  googleMapsUri?: string;
}

function toSummary(place: GooglePlace): PlaceSummary | null {
  if (!place.id) return null;
  const { latitude, longitude } = place.location ?? {};
  return {
    placeId: place.id,
    displayName: place.displayName?.text ?? "",
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    ...(typeof latitude === "number" && typeof longitude === "number"
      ? { location: { lat: latitude, lng: longitude } }
      : {}),
    types: place.types ?? [],
    ...(place.googleMapsUri ? { googleMapsUri: place.googleMapsUri } : {}),
  };
}

interface GooglePlaceDetails {
  displayName?: { text?: string };
  types?: string[];
  formattedAddress?: string;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: GoogleReviewJson[];
}

interface GoogleReviewJson {
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
  publishTime?: string;
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
  googleMapsUri?: string;
}

/** Copies only the keys whose value is present, so absent Google fields stay absent. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toBlock(placeId: string, place: GooglePlaceDetails): GoogleBlock {
  const hours = place.regularOpeningHours;
  return defined<GoogleBlock>({
    placeId,
    displayName: place.displayName?.text ?? "",
    types: place.types ?? [],
    formattedAddress: place.formattedAddress,
    openNow: hours?.openNow,
    weekdayHours: hours?.weekdayDescriptions?.length ? hours.weekdayDescriptions : undefined,
    nationalPhoneNumber: place.nationalPhoneNumber,
    websiteUri: place.websiteUri,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    googleMapsUri: place.googleMapsUri,
  });
}

function toReview(review: GoogleReviewJson): GoogleReview {
  const author = review.authorAttribution ?? {};
  return defined<GoogleReview>({
    rating: review.rating,
    text: review.text?.text,
    relativeTime: review.relativePublishTimeDescription,
    publishTime: review.publishTime,
    author: defined({ name: author.displayName ?? "", uri: author.uri, photoUri: author.photoUri }),
    googleMapsUri: review.googleMapsUri,
  });
}

/** Real adapter: Places API (New) over REST with the `places-api-key` secret. */
export function createGooglePlacesAdapter(options: GooglePlacesAdapterOptions): PlacesAdapter {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const cap = SHORTLIST_SEARCH_DAILY_CAP;

  /**
   * One Place Details call under `method`'s own cap. A 429 fills only that method's
   * counter: the other method finds Google's shared cap with its own refused call.
   */
  async function placeDetails(
    method: PlacesMethod,
    methodCap: number,
    fieldMask: string,
    { placeId, language }: PlaceDetailsRequest,
  ): Promise<{ ok: true; place: GooglePlaceDetails } | PlaceDetailsFailure> {
    if (!(await options.quota.tryConsume(method, methodCap))) return { ok: false, reason: "cap_reached" };
    const url = `${PLACE_DETAILS_URL}${encodeURIComponent(placeId)}?languageCode=${language}&regionCode=ID`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: { "x-goog-api-key": options.apiKey, "x-goog-fieldmask": fieldMask },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (response.status === 429) {
      await options.quota.markExhausted(method, methodCap);
      return { ok: false, reason: "cap_reached" };
    }
    // An unknown or malformed place id comes back as 404 or 400 INVALID_ARGUMENT.
    if (response.status === 404 || response.status === 400) return { ok: false, reason: "not_found" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    try {
      return { ok: true, place: (await response.json()) as GooglePlaceDetails };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  return {
    async searchText(search) {
      const method: PlacesMethod = "shortlistSearch";
      const limit = search.purpose === "emergency" ? cap : cap - EMERGENCY_RESERVE;
      if (!(await options.quota.tryConsume(method, limit))) return { ok: false, reason: "cap_reached" };

      const body: Record<string, unknown> = {
        textQuery: search.textQuery,
        includedType: search.includedType,
        languageCode: search.language,
        regionCode: "ID",
        pageSize: PAGE_SIZE,
      };
      if (search.locationBias) {
        const { center, radiusMeters } = search.locationBias;
        body.locationBias = {
          circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusMeters },
        };
      }

      let response: Response;
      try {
        response = await doFetch(TEXT_SEARCH_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": options.apiKey,
            "x-goog-fieldmask": SHORTLIST_SEARCH_FIELD_MASK,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (response.status === 429) {
        // Google's own per-project cap (infra/gcp/setup.sh): no point asking again today.
        await options.quota.markExhausted(method, cap);
        return { ok: false, reason: "cap_reached" };
      }
      if (!response.ok) return { ok: false, reason: "unavailable" };

      let json: { places?: GooglePlace[] };
      try {
        json = (await response.json()) as { places?: GooglePlace[] };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      const places = (json.places ?? []).map(toSummary).filter((p): p is PlaceSummary => p !== null);
      return { ok: true, places };
    },

    async getGoogleBlock(request) {
      const result = await placeDetails(
        "providerGoogleBlock",
        PROVIDER_GOOGLE_BLOCK_DAILY_CAP,
        PROVIDER_GOOGLE_BLOCK_FIELD_MASK,
        request,
      );
      return result.ok ? { ok: true, block: toBlock(request.placeId, result.place) } : result;
    },

    async getGoogleReviews(request) {
      const result = await placeDetails("googleReviews", GOOGLE_REVIEWS_DAILY_CAP, GOOGLE_REVIEWS_FIELD_MASK, request);
      return result.ok ? { ok: true, reviews: (result.place.reviews ?? []).map(toReview) } : result;
    },
  };
}
