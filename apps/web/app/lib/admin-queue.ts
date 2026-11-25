// The admin queue (spec 03, T14): shared by the /admin page and its JSON API
// (GET /admin/api/queue, POST /admin/api/actions). Plain types only.
import type {
  AspectRatings,
  ClaimDoc,
  DetectionRuleCode,
  ModerationDecisionDoc,
  PolicyViolationDoc,
  PolicyViolationStatus,
  ProcedureCode,
  ProofOfVisitExtracted,
  ProofPendingReason,
  ProviderType,
  RegionRef,
  ReportCategory,
  TestimonyStatus,
} from "@findyourdent/contracts/firestore";

/** Share of auto-published Testimonies sampled into the queue for a spot check (spec 03). */
export const SPOT_CHECK_RATE = 0.1;

/** Every queue item has this long from when it entered the queue. */
export const QUEUE_TARGET_HOURS = 24;

/** A pending Proof of Visit has this long (spec 09); the 7-day expiry is the backstop. */
export const PROOF_REVIEW_TARGET_HOURS = 72;

export const ADMIN_REASON_MAX_CHARS = 1000;

/** Actions on a Testimony, decided against the state machine (testimony-state.ts). */
export const TESTIMONY_ACTIONS = ["publish", "reject", "sendBackToAuthor", "hide", "remove"] as const;
export type TestimonyAction = (typeof TESTIMONY_ACTIONS)[number];

/** Actions on a pending Proof of Visit (spec 09); `subjectId` is the Testimony id. */
export const PROOF_ACTIONS = ["acceptProof", "rejectProof"] as const;
export type ProofAction = (typeof PROOF_ACTIONS)[number];

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

/**
 * Actions on Testimony Policy Violation cases (spec 09 part 2). `openViolation` takes the
 * place id as `subjectId` and the evidence in `violation`; the others take the violation id.
 */
export const VIOLATION_ACTIONS = ["openViolation", "notifyViolation", "confirmViolation", "dismissViolation"] as const;
export type ViolationAction = (typeof VIOLATION_ACTIONS)[number];

/** Actions that need a reason: it is shown to the author or claimant, or kept for disputes. */
export const REASON_REQUIRED: ReadonlySet<AdminActionRequest["action"]> = new Set([
  "reject",
  "sendBackToAuthor",
  "hide",
  "rejectProof",
  "remove",
  "rejectClaim",
  "revokeClaim",
  "rejectOwnerFacts",
  "rejectReply",
  ...VIOLATION_ACTIONS,
]);

/** What an admin gives when opening a violation case; `suspectedFrom` and `suspectedTo` are Jakarta dates `YYYY-MM-DD`. */
export interface OpenViolationInput {
  /** `testimonyReports` ids for the place (at most VIOLATION_EVIDENCE_MAX_IDS); the server parser fills a missing list with none. */
  reportIds: string[];
  /** Testimony ids for the place that detection held (at most VIOLATION_EVIDENCE_MAX_IDS). */
  detectionHoldIds: string[];
  notes?: string;
  suspectedFrom: string;
  suspectedTo: string;
}

/** Most report ids, and most detection-hold ids, one case may cite. */
export const VIOLATION_EVIDENCE_MAX_IDS = 50;

/**
 * POST /admin/api/actions. `subjectId` is the Testimony id for Testimony actions, the
 * report id for dismissReport, the correction id for name corrections, the
 * Moderation decision id for spotCheckConfirm, the Claim id for Claim actions, the
 * place id for owner facts and the Testimony id for replies and proof actions; for
 * violation cases the place id (openViolation) or the violation id (the rest).
 */
export interface AdminActionRequest {
  action:
    | TestimonyAction
    | ProofAction
    | OwnerAction
    | ViolationAction
    | "dismissReport"
    | "applyNameCorrection"
    | "dismissNameCorrection"
    | "spotCheckConfirm";
  subjectId: string;
  reason?: string;
  /** Only for openViolation. */
  violation?: OpenViolationInput;
}

export interface AdminActionResponse {
  ok: true;
  actionId: string;
  /** The new case, for openViolation. */
  violationId?: string;
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
  | "proofReview"
  | "claim"
  | "ownerFacts"
  | "reply"
  | "policyViolation";

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
  "decision" | "ruleCodes" | "detectionRuleCodes" | "flaggedSpans" | "flaggedPhotos" | "confidence" | "model"
>;

/** How much of a linked Testimony's text the queue shows. */
export const LINKED_TEXT_PREVIEW_CHARS = 160;

/** Another Testimony for the same Provider in the detection window (spec 09 part 2). */
export interface QueueLinkedTestimony {
  id: string;
  displayName: string;
  status: TestimonyStatus;
  /** ISO. */
  createdAt: string;
  /** Submitted within the D1 24-hour window before the held one (else only the 7-day one). */
  withinDay: boolean;
  /** The text, cut to LINKED_TEXT_PREVIEW_CHARS. */
  textPreview: string;
  /** Its author has a Testimony, not deleted, for any other Provider. */
  wroteAboutOtherProviders: boolean;
}

/** Admin only: why detection held a Testimony Moderation would have published. */
export interface QueueDetection {
  ruleCodes: DetectionRuleCode[];
  /** The held Testimony's own author has written about any other Provider. */
  authorWroteAboutOtherProviders: boolean;
  /** The Provider's other Testimonies (not deleted) in the 7 days up to the held one, oldest first. */
  linked: QueueLinkedTestimony[];
}

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

/** How two Proof Fingerprints match (spec 09): same read facts, same PDF, or a near-identical image. */
export type ReuseMatchKind = "fieldsKey" | "fileHash" | "perceptualHash";

/** Another Testimony whose Proof Fingerprint matches this proof, shown for `possibleReuse`. */
export interface QueueProofMatch {
  testimonyId: string;
  displayName: string;
  status: TestimonyStatus;
  proofResult: "accepted" | "pending";
  matchedOn: ReuseMatchKind[];
  /** Public Provider page, when the Testimony is published. */
  href?: string;
}

/** A pending Proof of Visit for the admin: the private file, what was read off it and why it waits. */
export interface QueueProof {
  /** Admin-only route that streams the private proof file. */
  fileUrl: string;
  reasons: ProofPendingReason[];
  extracted?: ProofOfVisitExtracted;
  /** The Testimonies whose Proof Fingerprint matches this proof, shown for `possibleReuse`. */
  reuseMatches?: QueueProofMatch[];
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

/**
 * A Testimony Policy Violation case waiting on an admin: `open` (to notify or dismiss) or
 * `providerNotified` (to confirm after the window, or dismiss). Admin only.
 */
export interface QueuePolicyViolation {
  placeId: string;
  /** The Listed name; empty when the place is not Listed. */
  providerName: string;
  /** The Provider has an approved Claim, so it is notified and responds in its owner pages. */
  claimed: boolean;
  status: Extract<PolicyViolationStatus, "open" | "providerNotified">;
  evidence: {
    reportIds: string[];
    detectionHoldIds: string[];
    notes?: string;
    /** How many private evidence files are held; the paths stay server side. */
    privateEvidenceCount: number;
  };
  suspectedPeriod: PolicyViolationDoc["suspectedPeriod"];
  notifiedVia?: PolicyViolationDoc["notifiedVia"];
  phoneContactNote?: string;
  /** ISO. */
  responseDueAt?: string;
  /** The response window is over: an admin may confirm. */
  windowOver: boolean;
  providerResponse?: { text: string; respondedAt: string };
  /** For an unclaimed place: live from the Google listing for this check, never stored; null when Places had no answer. */
  googlePhone?: string | null;
  googleDisplayName?: string | null;
}

export interface QueueItem {
  /** Unique in the queue: the Testimony, correction, Moderation decision, Claim or place id. */
  id: string;
  kind: QueueItemKind;
  /** What the actions take as `subjectId` (spot checks: the Testimony; confirm with `id`). */
  subjectId: string;
  /** When it entered the queue, ISO. */
  createdAt: string;
  /** createdAt + the target (24 hours; 72 for a proof review), ISO. */
  dueAt: string;
  overdue: boolean;
  testimony?: QueueTestimony;
  /** On a `held` item that detection held. */
  detection?: QueueDetection;
  reports?: QueueReport[];
  correction?: QueueNameCorrection;
  proof?: QueueProof;
  claim?: QueueClaim;
  ownerFacts?: QueueOwnerFacts;
  reply?: QueueReply;
  violation?: QueuePolicyViolation;
}

/** GET /admin/api/queue: hidden Testimonies first, then oldest first. */
export interface AdminQueueResponse {
  items: QueueItem[];
  /** Approved Claims, newest first, for revoking. */
  approvedClaims: ApprovedClaim[];
}
