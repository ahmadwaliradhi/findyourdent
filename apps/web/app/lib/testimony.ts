// Shared by the posting form (browser) and the Testimony web API (server), spec 03.
// Plain types and limits only, so it stays light in the browser bundle.
import type { FlaggedSpan, ModerationRuleCode } from "@findyourdent/contracts";
import type { AspectRatings, RegionRef, TestimonyDoc, YearMonth } from "@findyourdent/contracts/firestore";
import type { AuthorProofFeedback, AuthorProofStatus } from "./proof-status";

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

/** After this many authorFix rounds the Testimony is held for the team instead (spec 03). */
export const MAX_AUTHOR_FIX_ROUNDS = 3;

/**
 * Proof attempts a Testimony may have (spec 09, GLOSSARY: Proof attempt): the proof sent
 * with it, one sent with an edit that is stored, and each one attached later. After that
 * the author waits for the team's decision on a pending proof, or deletes and rewrites.
 */
export const MAX_PROOF_ATTEMPTS = 3;

type ProofAttemptFields = Pick<TestimonyDoc, "proofAttempts" | "proofOfVisit">;

/**
 * Proof attempts the Testimony has used. A Testimony stored before the count existed has
 * used one if it carries a proof decision, else none.
 */
export function proofAttemptsUsed(testimony: ProofAttemptFields): number {
  return testimony.proofAttempts ?? (testimony.proofOfVisit ? 1 : 0);
}

/** Proof attempts left for the Testimony, never below zero. */
export function proofAttemptsLeft(testimony: ProofAttemptFields): number {
  return Math.max(0, MAX_PROOF_ATTEMPTS - proofAttemptsUsed(testimony));
}

/** Why a proof cannot be attached to a Testimony now, in the order the author is told. */
export type ProofAttachRefusal = "not_published" | "already_proven" | "proof_pending" | "proof_attempts_used";

/**
 * Whether the author may attach a proof to the Testimony (spec 09): only a published one
 * without an accepted proof, not while a proof waits for the team (the author waits for
 * that decision), and only with proof attempts left. Null when attaching is allowed.
 */
export function proofAttachRefusal(
  testimony: Pick<TestimonyDoc, "status" | "verifiedVisit" | "proofAttempts" | "proofOfVisit">,
): ProofAttachRefusal | null {
  if (testimony.status !== "published") return "not_published";
  if (testimony.proofOfVisit?.result === "accepted" || testimony.verifiedVisit) return "already_proven";
  if (testimony.proofOfVisit?.result === "pending") return "proof_pending";
  if (proofAttemptsUsed(testimony) >= MAX_PROOF_ATTEMPTS) return "proof_attempts_used";
  return null;
}

/** The rules the author can fix before submitting (spec 03); every other rule holds. */
export const AUTHOR_FIXABLE_RULES = [
  "r1_personal_data",
  "r4_not_first_hand",
  "r5_medical_advice",
  "r6_wrong_provider",
] as const satisfies readonly ModerationRuleCode[];
export type AuthorFixableRule = (typeof AUTHOR_FIXABLE_RULES)[number];

export function isAuthorFixable(code: string): code is AuthorFixableRule {
  return (AUTHOR_FIXABLE_RULES as readonly string[]).includes(code);
}

/** 201 (create) or 200 (edit) body: Moderation decided and the Testimony was stored. */
export interface TestimonyStoredResponse {
  testimonyId: string;
  /** The state the Testimony (or, for an edit of a published one, its pending revision) is now in. */
  status: "published" | "held";
  /** For the author: on held, the plain reason and the 24-hour target. */
  message: string;
  /** Whether the Testimony shows Kunjungan terbukti. */
  verifiedVisit: boolean;
  /** The author shared their own health details: a gentle note only, never a hold (R8). */
  ownHealthDataWarning?: boolean;
  /**
   * Only when a Proof of Visit was sent: accepted, waiting for the team or not accepted,
   * with a plain sentence; `attemptsUsed` when an edit's proof was dropped unchecked
   * because the Testimony had used all its proof attempts.
   */
  proof?: AuthorProofFeedback;
}

/**
 * 200 body when Moderation found something the author can fix (spec 03). Nothing was
 * stored: the author edits and sends the whole form again.
 */
export interface TestimonyAuthorFixResponse {
  status: "needsAuthorFix";
  /** Edit only: the Testimony, unchanged. */
  testimonyId?: string;
  /** Moderation's author-facing message, in the author's language. */
  message: string;
  /** The text as it was screened (trimmed); the span offsets point into it. */
  text: string;
  /** Every rule that fired; a rule with no span (R6 on the typed name) still needs a fix. */
  ruleCodes: ModerationRuleCode[];
  /** UTF-16 offsets into `text`. */
  flaggedSpans: FlaggedSpan[];
  /** Fix rounds left before the next authorFix holds the Testimony for the team. */
  roundsLeft: number;
}

export type TestimonySubmitResponse = TestimonyStoredResponse | TestimonyAuthorFixResponse;

/**
 * POST /api/testimonies/:testimonyId/proof: a Proof of Visit attached to a published
 * Testimony later (spec 09), multipart with one `proof` file. 200 body once decided;
 * nothing public about the Testimony changes.
 */
export interface ProofAttachResponse {
  testimonyId: string;
  /** Whether the Testimony now shows Kunjungan terbukti. */
  verifiedVisit: boolean;
  /** Accepted, waiting for the team or not accepted, with a plain sentence. */
  proof: AuthorProofStatus & { message: string };
  /** Proof attempts left for this Testimony. */
  proofAttemptsLeft: number;
}

/** 200 body of delete. */
export interface TestimonyDeleteResponse {
  testimonyId: string;
  status: "deleted";
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
    /** Edit refused: the Testimony is hidden (a report is under review) or removed. Delete still works. */
    | "not_editable"
    /** Proof attach refused: only a published Testimony takes a later proof. */
    | "not_published"
    /** Proof attach refused: the Testimony already has an accepted proof. */
    | "already_proven"
    /** Proof attach refused: a proof already waits for the team's decision. */
    | "proof_pending"
    /** Proof attach refused: the Testimony has used all MAX_PROOF_ATTEMPTS proof attempts. */
    | "proof_attempts_used"
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
