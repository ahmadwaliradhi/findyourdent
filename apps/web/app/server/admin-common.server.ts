// Shared by every admin action and queue source (admin-queue.server.ts for Testimonies,
// reports and name corrections; owner-admin.server.ts for Claims, owner facts and replies).
import type { AdminActionDoc, AdminActionType, Timestamp as StoredTimestamp } from "@findyourdent/contracts/firestore";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { type AdminActionRequest, type AdminApiError, QUEUE_TARGET_HOURS, type QueueItem } from "~/lib/admin-queue";
import type { SignedInUser } from "../../server/auth.ts";

const HOUR_MS = 60 * 60 * 1000;

export const iso = (time: StoredTimestamp | undefined) =>
  time ? time.toDate().toISOString() : new Date(0).toISOString();

/** A queue item with its kind's target (QUEUE_TARGET_HOURS), counted from when it entered the queue. */
export function queueItem(
  base: Omit<QueueItem, "createdAt" | "dueAt" | "overdue">,
  enteredAt: StoredTimestamp | undefined,
  nowMs: number,
): QueueItem {
  const dueMs = (enteredAt?.toMillis() ?? 0) + QUEUE_TARGET_HOURS[base.kind] * HOUR_MS;
  return {
    ...base,
    createdAt: iso(enteredAt),
    dueAt: new Date(dueMs).toISOString(),
    overdue: nowMs > dueMs,
  };
}

/** An action the state machine or the data refuses, turned into an error response. */
export class AdminRefusal extends Error {
  readonly status: number;
  readonly code: AdminApiError["error"];

  constructor(status: number, code: AdminApiError["error"]) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export interface Acting {
  firestore: Firestore;
  admin: SignedInUser;
  request: AdminActionRequest;
  actionRef: DocumentReference;
}

/**
 * Appends the action to `adminActions` in the transaction that applies it. `action`
 * defaults to the request's; owner-content actions log as `publish` or `reject` with
 * their subject type.
 */
export function logAction(
  tx: Transaction,
  acting: Acting,
  entry: Omit<AdminActionDoc, "action" | "adminEmail" | "adminUid" | "createdAt" | "reason"> & {
    action?: AdminActionType;
  },
) {
  const { action, ...rest } = entry;
  const doc: AdminActionDoc = {
    action: action ?? (acting.request.action as AdminActionType),
    ...rest,
    adminEmail: acting.admin.email ?? "",
    adminUid: acting.admin.uid,
    ...(acting.request.reason ? { reason: acting.request.reason } : {}),
    createdAt: Timestamp.now(),
  };
  tx.create(acting.actionRef, doc);
}
