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

export interface PlacesAdapter {
  searchText(search: TextSearch): Promise<TextSearchResult>;
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
 * Adapter-side daily cap for Text Search (spec 02), matching the project quota
 * `SearchTextRequestPerDayPerProject` in infra/gcp/README.md.
 */
export const SHORTLIST_SEARCH_DAILY_CAP = 160;

/**
 * Shortlist searches stop this many short of the cap, so emergency Hospital searches
 * (which share it) are served first: about one in eight of the day's searches.
 */
export const EMERGENCY_RESERVE = 20;

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
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

/** Real adapter: Places API (New) over REST with the `places-api-key` secret. */
export function createGooglePlacesAdapter(options: GooglePlacesAdapterOptions): PlacesAdapter {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const method: PlacesMethod = "shortlistSearch";
  const cap = SHORTLIST_SEARCH_DAILY_CAP;

  return {
    async searchText(search) {
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
  };
}
