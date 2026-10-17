// Shared by the posting form (browser) and the Testimony web API (server), spec 03.
// Plain types and limits only, so it stays light in the browser bundle.
import type { AspectRatings, RegionRef, TestimonyStatus, YearMonth } from "@findyourdent/contracts/firestore";

export const TESTIMONY_LIMITS = {
  /** Technical cap; there is no product limit on length. */
  textMaxChars: 10_000,
  photosMax: 4,
  photoMaxBytes: 8 * 1024 * 1024,
  proofMaxBytes: 10 * 1024 * 1024,
  providerNameMaxChars: 120,
  displayNameMaxChars: 60,
  correctionNameMaxChars: 120,
  /** Highest price accepted, in rupiah. */
  priceMaxRupiah: 1_000_000_000,
} as const;

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PROOF_MIME_TYPES = [...PHOTO_MIME_TYPES, "application/pdf"] as const;

/** Version of the posting rules the author confirms (stored in `consent.termsVersion`). */
export const TESTIMONY_TERMS_VERSION = "2026-10";

/** Picker queries wait for a typing pause this long and at least this many characters (spec 03). */
export const AUTOCOMPLETE_DEBOUNCE_MS = 300;
export const AUTOCOMPLETE_MIN_CHARS = 3;

/**
 * The JSON part (`testimony` field) of the multipart body sent to
 * POST /api/testimonies (create) and POST /api/testimonies/:testimonyId (edit).
 * Files travel beside it: `photos` (0 to 4 images) and `proof` (0 or 1 image or PDF).
 */
export interface TestimonySubmission {
  /** From the chosen Autocomplete suggestion. Ignored on edit (the Provider never changes). */
  placeId: string;
  /**
   * Typed name for a place that is not yet a Listed Provider. Ignored when the place
   * is already Listed (its stored name wins). Never Google's name.
   */
  providerName?: string;
  /** Required when the place is not yet Listed; ignored when it is. */
  region?: RegionRef;
  ratings: AspectRatings;
  text: string;
  visitMonth: YearMonth;
  procedureCode?: string;
  pricePaidRupiah?: number;
  /** Public name; the form proposes first name plus initial. */
  displayName: string;
  /** Both must be true. */
  consent: { honestExperience: boolean; noOthersPersonalData: boolean };
  /** Edit only: stored photo paths to keep; any not listed are deleted. */
  keepPhotoPaths?: string[];
}

/** Multipart field names of the submit body. */
export const SUBMISSION_FIELDS = { json: "testimony", photos: "photos", proof: "proof" } as const;

/** 200/201 body of create and edit. */
export interface TestimonySubmitResponse {
  testimonyId: string;
  /** The state the Testimony (or, for an edit of a published one, its pending revision) is now in. */
  status: TestimonyStatus;
}

/** Error body of every Testimony API route. */
export interface TestimonyApiError {
  error:
    | "sign_in_required"
    | "app_check_required"
    | "rate_limited"
    | "invalid_submission"
    | "invalid_file"
    | "already_posted"
    | "not_found"
    | "forbidden"
    | "unavailable";
  /** Friendly message in the Patient's language. */
  message: string;
  /** Field name to message, for invalid_submission. */
  fieldErrors?: Record<string, string>;
  /** For already_posted: the existing Testimony to edit instead. */
  testimonyId?: string;
}

/** GET /api/places/autocomplete?input=&sessionToken=[&lat=&lng=] */
export interface AutocompleteResponse {
  /** Google's words, shown in the list only and never stored or kept in the draft. */
  suggestions: Array<{ placeId: string; mainText: string; secondaryText?: string }>;
  /** Set when the daily cap is reached or Places failed: the picker says to try later. */
  unavailable?: boolean;
}

/** GET /api/providers/:placeId/listing: whether the place is already a Listed Provider. */
export type ProviderListingResponse = { listed: true; name: string; region: RegionRef } | { listed: false };

/** POST /api/providers/:placeId/name-corrections (signed in): "Sarankan koreksi". */
export interface NameCorrectionRequest {
  suggestedName?: string;
  suggestedRegion?: RegionRef;
}

/**
 * The Provider part of the form, owned by <ProviderFields> (provider picker, typed
 * name and Region). Kept in the browser draft, so it holds no Google name.
 */
export interface ProviderFieldsValue {
  placeId: string | null;
  /** The Listed Provider's stored name and Region, when the picked place is Listed. */
  listed: { name: string; region: RegionRef } | null;
  /** Typed name, for a place that is not yet Listed. */
  providerName: string;
  region: { provinceCode: string; regencyCode: string; districtCode?: string };
}

export const EMPTY_PROVIDER_FIELDS: ProviderFieldsValue = {
  placeId: null,
  listed: null,
  providerName: "",
  region: { provinceCode: "", regencyCode: "" },
};

/** Default public name: first name plus initial ("Siti Rahma Dewi" → "Siti R."). */
export function defaultDisplayName(fullName: string | null | undefined): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const [first, second] = words;
  if (!first) return "";
  return second ? `${first} ${second[0]?.toUpperCase()}.` : first;
}
