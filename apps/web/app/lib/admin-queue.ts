// The admin queue (spec 03, T14): shared by the /admin page and its JSON API
// (GET /admin/api/queue, POST /admin/api/actions). Plain types only.
import type {
  AspectRatings,
  ClaimDoc,
  ModerationDecisionDoc,
  ProcedureCode,
  ProofPendingReason,
  ProviderType,
  RegionRef,
  ReportCategory,
  TestimonyStatus,
} from "@findyourdent/contracts/firestore";

/** Share of auto-published Testimonies sampled into the queue for a spot check (spec 03). */
export const SPOT_CHECK_RATE = 0.1;

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

/** Actions on a Proof of Visit waiting for the team (spec 09); `subjectId` is the Testimony id. */
export const PROOF_ACTIONS = ["acceptProof", "rejectProof"] as const;
export type ProofAction = (typeof PROOF_ACTIONS)[number];

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
  "rejectProof",
]);

/**
 * POST /admin/api/actions. `subjectId` is the Testimony id for Testimony actions, the
 * report id for dismissReport, the correction id for name corrections, the
 * Moderation decision id for spotCheckConfirm, the Claim id for Claim actions, the
 * place id for owner facts and the Testimony id for replies and proofs.
 */
export interface AdminActionRequest {
  action:
    | TestimonyAction
    | OwnerAction
    | ProofAction
    | "dismissReport"
    | "applyNameCorrection"
    | "dismissNameCorrection"
    | "spotCheckConfirm";
  subjectId: string;
  reason?: string;
  /**
   * Proof actions only, and required there: when the proof the admin was shown was checked
   * (`QueueProof.checkedAt`). A proof the author replaced since is refused (`proof_changed`).
   */
  proofCheckedAt?: string;
}

export interface AdminActionResponse {
  ok: true;
  actionId: string;
}

export interface AdminApiError {
  error: "invalid_action" | "reason_required" | "not_found" | "not_allowed" | "unavailable" | "proof_changed";
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
  | "reply"
  | "proof";

/**
 * Hours an item has from when it entered the queue: 24 for everything of spec 03 and
 * spec 05, 72 for a proof review (spec 09).
 */
export const QUEUE_TARGET_HOURS: Readonly<Record<QueueItemKind, number>> = {
  held: 24,
  hidden: 24,
  revision: 24,
  report: 24,
  spotCheck: 24,
  nameCorrection: 24,
  claim: 24,
  ownerFacts: 24,
  reply: 24,
  proof: 72,
};

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

/** Another Testimony whose Proof Fingerprint matched this proof (`possibleReuse`, ticket #130). */
export interface QueueProofMatch {
  testimonyId: string;
  placeId: string;
  displayName: string;
  status: TestimonyStatus;
}

/**
 * A Proof of Visit waiting for the team (spec 09): the file, what the agent read from
 * it (never a patient name) and why it waits. Its Testimony stays as it is meanwhile.
 */
export interface QueueProof {
  testimonyId: string;
  placeId: string;
  /** The Listed name, or the name the author typed while the place is not Listed. */
  providerName: string;
  listed: boolean;
  testimonyStatus: TestimonyStatus;
  /** When this proof was checked, ISO: which proof the admin decides on (`proofCheckedAt`). */
  checkedAt: string;
  /** The visit month the author stated, YYYY-MM. */
  visitMonth: string;
  displayName: string;
  /** Admin-only route that streams the private file; null once it is gone. */
  fileUrl: string | null;
  fileType?: "image" | "pdf";
  clinicNameOnProof?: string;
  /** YYYY-MM-DD when a day was printed, else YYYY-MM. */
  proofDate?: string;
  totalRupiah?: number;
  reasons: ProofPendingReason[];
  /** Proofs checked for this Testimony so far, this one included. */
  attempts: number;
  /** Other Testimonies whose Proof Fingerprint matches this proof's, as of loading the queue. */
  matchingTestimonies: QueueProofMatch[];
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
  /**
   * Unique per kind: the Testimony, correction, Moderation decision, Claim or place id;
   * `reply-` or `proof-` and the Testimony id for replies and proofs.
   */
  id: string;
  kind: QueueItemKind;
  /** What the actions take as `subjectId` (spot checks: the Testimony; confirm with `id`). */
  subjectId: string;
  /** When it entered the queue, ISO. */
  createdAt: string;
  /** createdAt + the kind's target hours (QUEUE_TARGET_HOURS), ISO. */
  dueAt: string;
  overdue: boolean;
  testimony?: QueueTestimony;
  reports?: QueueReport[];
  correction?: QueueNameCorrection;
  claim?: QueueClaim;
  ownerFacts?: QueueOwnerFacts;
  reply?: QueueReply;
  proof?: QueueProof;
}

/** GET /admin/api/queue: hidden Testimonies first, then oldest first. */
export interface AdminQueueResponse {
  items: QueueItem[];
  /** Approved Claims, newest first, for revoking. */
  approvedClaims: ApprovedClaim[];
}
