// The admin queue (spec 03, T14): shared by the /admin page and its JSON API
// (GET /admin/api/queue, POST /admin/api/actions). Plain types only.
import type {
  AdminActionType,
  AspectRatings,
  ModerationDecisionDoc,
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

/** Actions that need a reason: it is shown to the author or kept for disputes. */
export const REASON_REQUIRED: ReadonlySet<AdminActionType> = new Set(["reject", "sendBackToAuthor", "hide", "remove"]);

/**
 * POST /admin/api/actions. `subjectId` is the Testimony id for Testimony actions, the
 * report id for dismissReport, the correction id for name corrections and the
 * Moderation decision id for spotCheckConfirm.
 */
export interface AdminActionRequest {
  action: TestimonyAction | "dismissReport" | "applyNameCorrection" | "dismissNameCorrection" | "spotCheckConfirm";
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

export type QueueItemKind = "held" | "revision" | "report" | "spotCheck" | "nameCorrection";

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

export interface QueueItem {
  /** Unique in the queue: the Testimony, correction or Moderation decision id. */
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
}

/** GET /admin/api/queue: hidden-by-report first, then oldest first. */
export interface AdminQueueResponse {
  items: QueueItem[];
}
