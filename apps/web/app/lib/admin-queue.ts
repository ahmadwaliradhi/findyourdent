// The admin queue (spec 03, T14): shared by the /admin page and its JSON API
// (GET /admin/api/queue, POST /admin/api/actions). Plain types only.
import type {
  AspectRatings,
  ClaimDoc,
  ModerationDecisionDoc,
  ProcedureCode,
  ProviderType,
  RegionRef,
  ReportCategory,
  TestimonyStatus,
} from "@findyourdent/contracts/firestore";

/** Share of auto-published Testimonies sampled into the queue for a spot check (spec 03). */
export const SPOT_CHECK_RATE = 0.1;

/** Every queue item has this long from when it entered the queue. */
export const QUEUE_TARGET_HOURS = 24;

export const ADMIN_REASON_MAX_CHARS = 1000;

/** Actions on a Testimony, decided against the state machine (testimony-state.ts). */
export const TESTIMONY_ACTIONS = ["publish", "reject", "sendBackToAuthor", "hide", "remove"] as const;
export type TestimonyAction = (typeof TESTIMONY_ACTIONS)[number];

/** Actions on Claims, owner facts and replies (spec 05). */
export const OWNER_ACTIONS = [
  "approveClaim",
  "rejectClaim",
  "revokeClaim",
  "publishOwnerFacts",
  "rejectOwnerFacts",
  "publishReply",
  "rejectReply",
] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];

/** Actions that need a reason: it is shown to the author or claimant, or kept for disputes. */
export const REASON_REQUIRED: ReadonlySet<AdminActionRequest["action"]> = new Set([
  "reject",
  "sendBackToAuthor",
  "hide",
  "remove",
  "rejectClaim",
  "revokeClaim",
  "rejectOwnerFacts",
  "rejectReply",
]);

/**
 * POST /admin/api/actions. `subjectId` is the Testimony id for Testimony actions, the
 * report id for dismissReport, the correction id for name corrections, the
 * Moderation decision id for spotCheckConfirm, the Claim id for Claim actions, the
 * place id for owner facts and the Testimony id for replies.
 */
export interface AdminActionRequest {
  action:
    | TestimonyAction
    | OwnerAction
    | "dismissReport"
    | "applyNameCorrection"
    | "dismissNameCorrection"
    | "spotCheckConfirm";
  subjectId: string;
  reason?: string;
}

export interface AdminActionResponse {
  ok: true;
  actionId: string;
}

export interface AdminApiError {
  error: "invalid_action" | "reason_required" | "not_found" | "not_allowed" | "unavailable";
  message: string;
}

/** `hidden`: hidden by an admin with no open report; it still waits for publish or remove. */
export type QueueItemKind =
  | "held"
  | "hidden"
  | "revision"
  | "report"
  | "spotCheck"
  | "nameCorrection"
  | "claim"
  | "ownerFacts"
  | "reply";

export interface QueueHistoryEntry {
  /** ISO time. */
  at: string;
  kind: "moderation" | "report" | "admin";
  /** Decision, report category or admin action. */
  label: string;
  detail?: string;
  /** Admin email, for admin entries. */
  by?: string;
}

export type QueueModeration = Pick<
  ModerationDecisionDoc,
  "decision" | "ruleCodes" | "flaggedSpans" | "flaggedPhotos" | "confidence" | "model"
>;

export interface QueueTestimonyContent {
  ratings: AspectRatings;
  text: string;
  visitMonth: string;
  procedureCode?: string;
  pricePaidRupiah?: number;
  displayName: string;
  photoUrls: string[];
}

export interface QueueTestimony extends QueueTestimonyContent {
  id: string;
  placeId: string;
  /** The Listed name, or the name the author typed while the place is not Listed. */
  providerName: string;
  listed: boolean;
  status: TestimonyStatus;
  verifiedVisit: boolean;
  adminReason?: string;
  /** A held edit of the published version. */
  revision?: QueueTestimonyContent;
  /** Latest Moderation decision for what is being decided (the revision when there is one). */
  moderation: QueueModeration | null;
  history: QueueHistoryEntry[];
}

export interface QueueReport {
  id: string;
  category: ReportCategory;
  details?: string;
  hidTestimony: boolean;
  createdAt: string;
}

export interface QueueNameCorrection {
  placeId: string;
  currentName: string;
  currentRegion: RegionRef;
  suggestedName?: string;
  suggestedRegion?: RegionRef;
}

/** A submitted Claim: the admin opens the permit, then phones the Google listing number. */
export interface QueueClaim {
  placeId: string;
  /** The Listed name, or the name the claimant gave for a place that is not Listed. */
  providerName: string;
  listed: boolean;
  role: ClaimDoc["role"];
  contactPhone: string;
  /** Admin-only route that streams the private permit. */
  permitUrl: string | null;
  /** Live from the Google listing for this check, never stored; null when Places had no answer. */
  googlePhone: string | null;
  googleDisplayName: string | null;
}

export interface QueueOwnerFactsValues {
  name: string;
  providerType: ProviderType;
  region: RegionRef;
  address?: string;
  phone?: string;
  whatsapp?: string;
  openingHours?: string;
  services: ProcedureCode[];
}

/** Owner facts held by Moderation. */
export interface QueueOwnerFacts {
  placeId: string;
  /** What the page shows now. */
  currentName: string;
  facts: QueueOwnerFactsValues;
  moderation: QueueModeration | null;
}

/** A claimed Provider's reply held by Moderation, with the Testimony it answers. */
export interface QueueReply {
  testimonyId: string;
  placeId: string;
  providerName: string;
  testimonyText: string;
  text: string;
  moderation: QueueModeration | null;
}

/** An approved Claim, listed so an admin can revoke a wrong approval. */
export interface ApprovedClaim {
  claimId: string;
  placeId: string;
  providerName: string;
  reviewedBy?: string;
  reviewedAt: string;
}

export interface QueueItem {
  /** Unique in the queue: the Testimony, correction, Moderation decision, Claim or place id. */
  id: string;
  kind: QueueItemKind;
  /** What the actions take as `subjectId` (spot checks: the Testimony; confirm with `id`). */
  subjectId: string;
  /** When it entered the queue, ISO. */
  createdAt: string;
  /** createdAt + 24 hours, ISO. */
  dueAt: string;
  overdue: boolean;
  testimony?: QueueTestimony;
  reports?: QueueReport[];
  correction?: QueueNameCorrection;
  claim?: QueueClaim;
  ownerFacts?: QueueOwnerFacts;
  reply?: QueueReply;
}

/** GET /admin/api/queue: hidden Testimonies first, then oldest first. */
export interface AdminQueueResponse {
  items: QueueItem[];
  /** Approved Claims, newest first, for revoking. */
  approvedClaims: ApprovedClaim[];
}
