// The Testimony state machine (spec 03, "Testimony states"). Pure, so posting (T11),
// Moderation (T13) and the admin queue (T14) all check moves against one table.
import type { TestimonyStatus } from "@findyourdent/contracts/firestore";

export const TESTIMONY_STATUSES: readonly TestimonyStatus[] = [
  "submitted",
  "published",
  "needsAuthorFix",
  "held",
  "rejected",
  "hidden",
  "removed",
  "deleted",
];

/** author: the Patient who wrote it; admin: an allowlisted team member; system: Moderation or a report rule. */
export type TransitionActor = "author" | "admin" | "system";

type Edge = `${TestimonyStatus}>${TestimonyStatus}`;

const EDGES: Record<TransitionActor, ReadonlySet<Edge>> = {
  system: new Set<Edge>([
    "submitted>published",
    "submitted>needsAuthorFix",
    "submitted>held",
    // A personal data or threat report hides at once, before any human looks.
    "published>hidden",
  ]),
  admin: new Set<Edge>([
    "held>published",
    "held>rejected",
    // "Send back to the author" from the queue.
    "held>needsAuthorFix",
    "published>hidden",
    "hidden>published",
    "hidden>removed",
    // Only a human removes anything published.
    "published>removed",
  ]),
  author: new Set<Edge>([
    // Resubmitting after a fix runs Moderation again.
    "needsAuthorFix>submitted",
    // An edit of a held or rejected Testimony is screened again but goes back to the
    // admin queue: only a human decides it (ADR-0004).
    "rejected>held",
  ]),
};

/**
 * Whether `actor` may move a Testimony from `from` to `to`. The author may delete
 * from any state; nothing leaves `deleted`. Editing a `published` Testimony is not a
 * status move: the edit waits in `pendingRevision` while the public version stays.
 */
export function canTransition(from: TestimonyStatus, to: TestimonyStatus, actor: TransitionActor): boolean {
  if (from === "deleted") return false;
  if (to === "deleted") return actor === "author";
  return EDGES[actor].has(`${from}>${to}`);
}

/**
 * Whether the author may edit. Not while `hidden` (a report is under review and an
 * edit would sidestep it) nor once `removed` (a final admin decision); the author can
 * still delete either. A `published` edit becomes a pending revision.
 */
export function canAuthorEdit(status: TestimonyStatus): boolean {
  return status !== "hidden" && status !== "removed" && status !== "deleted";
}
