// Claims, owner facts and replies (spec 05, T17), shared by the browser and the web
// API. Plain types only. Every owner-facing feature here keeps to the ethics rules:
// no promotion, no badge but "Diklaim pemilik", no way to delete or hide a Testimony.
import type { ClaimDoc, ClaimStatus, ProcedureCode, ProviderType, RegionRef } from "@findyourdent/contracts/firestore";

export const CLAIM_ROLES: readonly ClaimDoc["role"][] = ["owner", "practisingDentist", "manager"];

export const PROVIDER_TYPES: readonly ProviderType[] = ["klinik", "privateDentist", "hospital"];

/** SIP or izin praktik: one image or PDF. */
export const PERMIT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const PERMIT_MAX_BYTES = 10 * 1024 * 1024;

/** Working days the team gives itself to check the document and phone the Google listing number. */
export const CLAIM_CHECK_WORKING_DAYS = 2;

export const OWNER_LIMITS = {
  nameMax: 120,
  addressMax: 300,
  phoneMax: 30,
  openingHoursMax: 500,
  replyMax: 2000,
  servicesMax: 30,
} as const;

/** Multipart field names of POST /api/providers/:placeId/claims. */
export const CLAIM_FIELDS = { json: "claim", permit: "permit" } as const;

/**
 * The `claim` JSON part. A place that is not yet a Listed Provider needs the name and
 * Region it will be listed under once the Claim is approved.
 */
export interface ClaimSubmission {
  role: ClaimDoc["role"];
  contactPhone: string;
  providerName?: string;
  region?: RegionRef;
}

/** 201 body of a new Claim. */
export interface ClaimSubmitResponse {
  claimId: string;
  status: "submitted";
  message: string;
}

/** POST /api/providers/:placeId/owner-facts, JSON. Only the approved claimant. */
export interface OwnerFactsSubmission {
  name: string;
  providerType: ProviderType;
  region: RegionRef;
  address?: string;
  phone?: string;
  whatsapp?: string;
  openingHours?: string;
  services: ProcedureCode[];
}

/** POST /api/testimonies/:testimonyId/reply, JSON. One reply per Testimony; sending again edits it. */
export interface ReplySubmission {
  text: string;
}

/** 200 body for owner facts and replies: published at once, or held for the admin on any rule hit. */
export interface OwnerContentResponse {
  status: "published" | "held";
  message: string;
}

export interface ClaimApiError {
  error:
    | "app_check_required"
    | "rate_limited"
    | "sign_in_required"
    | "invalid_claim"
    | "invalid_file"
    | "invalid_facts"
    | "invalid_reply"
    | "claim_exists"
    | "not_owner"
    | "not_found"
    | "unavailable";
  message: string;
}

/** The signed-in user's own latest Claim on a place, for the Claim page. */
export interface MyClaim {
  claimId: string;
  status: ClaimStatus;
  rejectionReason?: string;
  createdAt: string;
}
