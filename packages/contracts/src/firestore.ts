// Firestore data model (documented in docs/data-model.md). Plain types, no
// Firebase SDK dependency: the web service maps them onto firebase-admin.
//
// Google Maps Platform terms: the only Google data ever stored is `placeId`
// (indefinitely) and coordinates with their fetch date (at most 30 days).
// Never add a Google name, address, phone, rating, type list or review here.

import type { ModerationDecision, ModerationRuleCode, PriceUnit, ProcedureCode } from "./generated/index.js";

export type { ProcedureCode };

/**
 * Structural match for firebase-admin's `Timestamp` as read back from
 * Firestore. Writers may pass a `Date` or `FieldValue.serverTimestamp()`.
 */
export interface Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

export const COLLECTIONS = {
  providers: "providers",
  testimonies: "testimonies",
  testimonyReports: "testimonyReports",
  claims: "claims",
  priceLists: "priceLists",
  moderationDecisions: "moderationDecisions",
  nameCorrections: "nameCorrections",
  adminActions: "adminActions",
  counters: "counters",
  rateLimits: "rateLimits",
} as const;
export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Google place id. Stored indefinitely; also the `providers` document id. */
export type PlaceId = string;
/** Firebase Auth uid. Never shown publicly. */
export type Uid = string;
/** Visit month, `YYYY-MM`. */
export type YearMonth = string;

export type ProviderType = "klinik" | "privateDentist" | "hospital";

/** Kemendagri codes from data/regions.json. */
export interface RegionRef {
  /** `NN`, required. */
  provinceCode: string;
  /** Kabupaten/kota `NN.NN`, required. */
  regencyCode: string;
  /** Kecamatan `NN.NN.NN`, optional. */
  districtCode?: string;
}

/** Coordinates from a Place Details Essentials call. Refresh or delete within 30 days. */
export interface StoredLocation {
  lat: number;
  lng: number;
  fetchedAt: Timestamp;
}

export interface AspectRatings {
  /** 1 to 5. */
  service: number;
  hygiene: number;
  materialsEquipment: number;
}

// providers/{placeId} ---------------------------------------------------------

/**
 * Owner-entered facts from an approved Claim (spec 05). First-party data. Once
 * published, name, type and Region are copied onto the Listed Provider (replacing
 * the first Testimony author's typed name and the inferred type); while held, the
 * Listed Provider keeps its previous values.
 */
export interface ProviderOwnerFacts {
  name: string;
  providerType: ProviderType;
  region: RegionRef;
  address?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  openingHours?: string;
  services?: ProcedureCode[];
  /** Moderation result for the current facts; held facts are not shown. */
  moderationStatus: "published" | "held";
  moderationDecisionId?: string;
  updatedAt: Timestamp;
}

export interface ProcedurePriceAggregate {
  /** Number of Proven Testimonies with a price for this procedure. */
  count: number;
  medianRupiah: number;
  minRupiah: number;
  maxRupiah: number;
}

/**
 * Recomputed whenever a Testimony enters or leaves `published` or its proof result
 * changes. Only Proven Testimonies (published, `verifiedVisit`) move the averages and
 * price stats (spec 09, ADR-0011).
 */
export interface ProviderAggregates {
  /** Every published Testimony, Proven or not; shown as a count only. */
  testimonyCount: number;
  /** Proven Testimonies: the count every score uses. */
  verifiedVisitCount: number;
  /** Aspect averages over Proven Testimonies; null below MIN_PROVEN_TESTIMONIES (3). */
  averages: AspectRatings | null;
  /** From Proven Testimonies, keyed by procedure code; the median is shown only when count >= 2. */
  procedurePrices: Record<ProcedureCode, ProcedurePriceAggregate>;
}

/** A Listed Provider. Document id = placeId. */
export interface ProviderDoc {
  placeId: PlaceId;
  /** First-party name: typed by the first Testimony author, or set by the Claim. Never Google's name. */
  name: string;
  nameSource: "testimonyAuthor" | "claim";
  /** Lower-cased, accents and punctuation stripped; for prefix search (spec 04). */
  nameNormalized: string;
  region: RegionRef;
  /** Absent once coordinates older than 30 days could not be refreshed. */
  location?: StoredLocation;
  providerType: ProviderType;
  /** inferred: from the rule in spec 02 ("perkiraan"); claimed: confirmed by a Claim. */
  providerTypeSource: "inferred" | "claimed";
  claimStatus: "unclaimed" | "claimed";
  /** Approved Claim id when claimed. */
  claimId?: string;
  /** Published owner facts; only these are shown. */
  ownerFacts?: ProviderOwnerFacts;
  /** An edit Moderation held for the admin; `ownerFacts` stays live until it is decided. */
  pendingOwnerFacts?: ProviderOwnerFacts;
  aggregates: ProviderAggregates;
  /** What made it a Listed Provider. */
  listedBy: "testimony" | "claim";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// testimonies/{testimonyId} ---------------------------------------------------

export type TestimonyStatus =
  | "submitted"
  | "published"
  | "needsAuthorFix"
  | "held"
  | "rejected"
  | "hidden"
  | "removed"
  | "deleted";

/** The author-editable part of a Testimony. */
export interface TestimonyContent {
  ratings: AspectRatings;
  /** Up to 10,000 characters. */
  text: string;
  visitMonth: YearMonth;
  procedureCode?: ProcedureCode;
  pricePaidRupiah?: number;
  /** Cloud Storage object paths, EXIF stripped, at most four. */
  photoPaths: string[];
}

export interface TestimonyReply {
  /** The claimed Provider's single public reply. */
  text: string;
  authorUid: Uid;
  claimId: string;
  status: "submitted" | "published" | "held" | "rejected";
  moderationDecisionId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Why a Proof of Visit waits for an admin (spec 09); they accumulate. */
export type ProofPendingReason = "nameMismatch" | "dateMismatch" | "possibleReuse";
/** Why a Proof of Visit was not accepted (spec 09). */
export type ProofRejectedReason = "unreadable" | "notAProof" | "tooOld" | "adminRejected" | "expired";

/**
 * The Proof of Visit check on a Testimony (spec 09). The file is deleted right after an
 * `accepted` or `rejected` result; a `pending` one stays in the private uploads bucket
 * (`proof-of-visit/{testimonyId}/`) for an admin. Never the patient's name. Proofs
 * checked before spec 09 carry only `result` (accepted or rejected) and `checkedAt`.
 */
export interface ProofOfVisitRecord {
  result: "accepted" | "pending" | "rejected";
  /** `pending` only: every reason it waits for an admin. */
  reasons?: ProofPendingReason[];
  /** `rejected` only. */
  reason?: ProofRejectedReason;
  checkedAt: Timestamp;
  /** Facts the agent read from the proof, as printed. */
  clinicNameOnProof?: string;
  /** YYYY-MM-DD when a day was printed, else YYYY-MM. */
  proofDate?: string;
  totalRupiah?: number;
  /** Proofs checked for this Testimony, the one sent with it included; at most 3. */
  attempts?: number;
}

/**
 * One per author per Provider (enforced in a transaction querying
 * authorUid + placeId). Random document id, so the uid never appears in URLs.
 */
export interface TestimonyDoc extends TestimonyContent {
  placeId: PlaceId;
  /**
   * Copied from the Listed Provider for feed filters (spec 04). Before the place is
   * Listed: the Region the author picked, and the type inferred from the typed name.
   */
  region: RegionRef;
  providerType: ProviderType;
  /**
   * The name the author typed for a place that was not yet a Listed Provider. Kept
   * until the Testimony is first published, when it names the new Listed Provider
   * (or is dropped, if another Testimony made the place Listed first). Never Google's name.
   */
  proposedProviderName?: string;
  authorUid: Uid;
  /** Public name chosen by the author (default: first name plus initial). */
  displayName: string;
  status: TestimonyStatus;
  /** Kunjungan terbukti: true only when `proofOfVisit.result` is `accepted` (spec 09). */
  verifiedVisit: boolean;
  /**
   * The Proof of Visit check, kept after its file is deleted. Absent when no proof was
   * sent (`notProvided`) or the proof could not be checked (the agent failed).
   */
  proofOfVisit?: ProofOfVisitRecord;
  consent: { termsVersion: string; acceptedAt: Timestamp };
  /** authorFix rounds so far; after three the Testimony is held. */
  authorFixRounds: number;
  /** Latest decision for the public version. */
  moderationDecisionId?: string;
  /** Reason given by the admin on `rejected` or `removed`. */
  adminReason?: string;
  /**
   * An edit of a published Testimony: re-enters Moderation while the public
   * fields above stay visible until it is decided.
   */
  pendingRevision?: TestimonyContent & {
    /** The public name chosen with this edit; replaces `displayName` when it is published. */
    displayName?: string;
    status: "submitted" | "needsAuthorFix" | "held";
    submittedAt: Timestamp;
    moderationDecisionId?: string;
  };
  reply?: TestimonyReply;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  publishedAt?: Timestamp;
  /** Set when the author deletes; text and photos are removed. */
  deletedAt?: Timestamp;
}

// testimonyReports/{reportId} -------------------------------------------------

export type ReportCategory = "personalData" | "threat" | "falseClaim" | "spam" | "conflictOfInterest" | "other";

export interface TestimonyReportDoc {
  testimonyId: string;
  placeId: PlaceId;
  category: ReportCategory;
  details?: string;
  /** Present when the reporter was signed in (a claimed Provider reports signed in). */
  reporterUid?: Uid;
  reporterRole: "public" | "claimedProvider";
  /** personalData and threat hide the Testimony immediately. */
  hidTestimony: boolean;
  status: "open" | "resolved";
  resolution?: "kept" | "removed" | "dismissed";
  resolvedBy?: string;
  resolvedAt?: Timestamp;
  /** 24-hour target from createdAt. */
  createdAt: Timestamp;
}

// claims/{claimId} -------------------------------------------------------------

export type ClaimStatus = "submitted" | "approved" | "rejected" | "revoked";

/** One active Claim (submitted or approved) per placeId. */
export interface ClaimDoc {
  placeId: PlaceId;
  claimantUid: Uid;
  role: "owner" | "practisingDentist" | "manager";
  contactPhone: string;
  /**
   * For a place that is not yet a Listed Provider: the name and Region it is listed
   * under when the Claim is approved. Never Google's name.
   */
  proposedProviderName?: string;
  proposedRegion?: RegionRef;
  /** Private bucket path; deleted (and this field removed) when the Claim leaves `submitted`. */
  permitDocumentPath?: string;
  status: ClaimStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// priceLists/{priceListId} -----------------------------------------------------

export interface PriceListRow {
  procedureCode?: ProcedureCode;
  procedureText: string;
  minRupiah: number;
  maxRupiah: number;
  unit: PriceUnit;
  notes?: string;
}

/**
 * Only confirmed rows are stored. An upload is a `draft` with no rows until the owner
 * confirms it; the confirmed list becomes `current` and the previous one `replaced`.
 */
export interface PriceListDoc {
  placeId: PlaceId;
  /** The approved Claim it was uploaded under; shown only while that Claim is the place's current one. */
  claimId: string;
  uploadedBy: Uid;
  /** Shown as "Daftar harga dari pemilik". */
  source: "ownerPriceList";
  status: "draft" | "current" | "replaced";
  /** Empty while `draft`. */
  rows: PriceListRow[];
  uploadedAt: Timestamp;
  /** Shown to Patients; older than 12 months shows "mungkin sudah berubah". Absent while `draft`. */
  confirmedAt?: Timestamp;
  /**
   * Private originals (`priceLists/{priceListId}/original-*`, one PDF or up to five
   * EXIF-stripped photos) kept 30 days for disputes, then deleted by the bucket's
   * lifecycle rule.
   */
  originalDocumentPaths?: string[];
  originalDeleteAfter?: Timestamp;
}

// moderationDecisions/{decisionId} ---------------------------------------------

/** Every Moderation call's result. Never stores the moderated text or photos. */
export interface ModerationDecisionDoc {
  subjectType: "testimony" | "testimonyRevision" | "reply" | "providerFacts";
  subjectId: string;
  placeId: PlaceId;
  decision: ModerationDecision["decision"];
  ruleCodes: ModerationRuleCode[];
  /** Offsets and text of flagged spans, kept for the admin queue. */
  flaggedSpans: ModerationDecision["flaggedSpans"];
  flaggedPhotos?: ModerationDecision["flaggedPhotos"];
  confidence: number;
  /** Model id from configuration, or "fallback" when the call failed. */
  model: string;
  /** Part of the 10% admin spot-check sample. */
  spotCheck: boolean;
  /** Sampled decisions only: false until an admin confirms the spot check. */
  spotCheckConfirmed?: boolean;
  decidedAt: Timestamp;
}

// nameCorrections/{correctionId} ------------------------------------------------

/**
 * A "Sarankan koreksi" suggestion on a Listed Provider's name or Region (spec 03).
 * Nothing changes on the Provider until an admin applies it (`applyNameCorrection`).
 */
export interface NameCorrectionDoc {
  placeId: PlaceId;
  /** At least one of suggestedName and suggestedRegion is present. */
  suggestedName?: string;
  suggestedRegion?: RegionRef;
  /** The stored values when the suggestion was made, so the admin sees the diff. */
  currentName: string;
  currentRegion: RegionRef;
  suggesterUid: Uid;
  status: "open" | "applied" | "dismissed";
  resolvedBy?: string;
  resolvedAt?: Timestamp;
  createdAt: Timestamp;
}

// adminActions/{actionId} -------------------------------------------------------

export type AdminActionType =
  | "publish"
  | "reject"
  | "sendBackToAuthor"
  | "hide"
  | "remove"
  | "dismissReport"
  | "approveClaim"
  | "rejectClaim"
  | "revokeClaim"
  | "applyNameCorrection"
  | "dismissNameCorrection"
  | "spotCheckConfirm";

/** Append-only audit log of every admin decision. */
export interface AdminActionDoc {
  action: AdminActionType;
  subjectType:
    | "testimony"
    | "reply"
    | "testimonyReport"
    | "claim"
    | "provider"
    | "providerFacts"
    | "nameCorrection"
    | "moderationDecision";
  subjectId: string;
  placeId?: PlaceId;
  /** Allowlisted admin email. */
  adminEmail: string;
  adminUid: Uid;
  reason?: string;
  fromStatus?: string;
  toStatus?: string;
  createdAt: Timestamp;
}

// counters/{counterId} ----------------------------------------------------------

/** Impact counters (spec 04), incremented with FieldValue.increment. */
export const IMPACT_COUNTERS = {
  testimoniesPublished: "impact.testimoniesPublished",
  listedProviders: "impact.listedProviders",
  guidanceSessionsCompleted: "impact.guidanceSessionsCompleted",
  verifiedVisits: "impact.verifiedVisits",
} as const;

export type PlacesMethod =
  | "shortlistSearch"
  | "providerGoogleBlock"
  | "googleReviews"
  | "coordinates"
  | "autocomplete"
  | "moderationName";

/** Daily paid-API usage counter id, e.g. `quota.places.shortlistSearch.2026-10-20` (Asia/Jakarta date). */
export function dailyQuotaCounterId(api: "places" | "gemini", method: string, jakartaDate: string): string {
  return `quota.${api}.${method}.${jakartaDate}`;
}

/**
 * authorFix rounds a Patient has used on their Testimony for one place, e.g.
 * `authorFix.<uid>.<placeId>`. Kept here rather than on a Testimony, because an
 * authorFix stores no submitted record (spec 03); deleted once one is stored.
 */
export function authorFixCounterId(uid: Uid, placeId: PlaceId): string {
  return `authorFix.${uid}.${placeId}`;
}

export interface CounterDoc {
  value: number;
  updatedAt: Timestamp;
  /** Daily quota counters only; Firestore TTL deletes them. */
  expiresAt?: Timestamp;
}

// rateLimits/{windowId} ---------------------------------------------------------

export type RateLimitScope = "appCheck" | "session" | "user" | "ip";

/**
 * Fixed-window counter. Document id: `${scope}.${keyHash}.${route}.${windowStartEpochSeconds}`.
 * `keyHash` is a salted SHA-256 of the token, session id, uid or IP, so no raw
 * IP address or token is stored.
 */
export interface RateLimitDoc {
  scope: RateLimitScope;
  keyHash: string;
  route: string;
  windowStart: Timestamp;
  windowSeconds: number;
  count: number;
  /** Firestore TTL field: windowStart + windowSeconds. */
  expiresAt: Timestamp;
}
