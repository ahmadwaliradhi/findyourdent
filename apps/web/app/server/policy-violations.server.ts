// Testimony Policy Violation cases (spec 09 part 2, issue #137): the admin opens a case
// on a Provider with its evidence, notifies the Provider, and after the 7-day window
// confirms or dismisses it. Every move is logged in `adminActions` in the transaction
// that applies it (`logAction`). Nothing here is public: the badge and the exclusion of
// Testimonies from scores come with a later issue. The pure move rule is in
// lib/policy-violations.ts.
import {
  COLLECTIONS,
  type PolicyViolationDoc,
  type ProviderDoc,
  type TestimonyDoc,
  type TestimonyReportDoc,
} from "@findyourdent/contracts/firestore";
import { type DocumentSnapshot, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import {
  ADMIN_REASON_MAX_CHARS,
  type OpenViolationInput,
  type QueueItem,
  type QueuePolicyViolation,
  VIOLATION_EVIDENCE_MAX_IDS,
  type ViolationAction,
} from "~/lib/admin-queue";
import { nextViolationStatus, VIOLATION_RESPONSE_DAYS } from "~/lib/policy-violations";
import { type Acting, AdminRefusal, logAction, queueItem } from "./admin-common.server.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const JAKARTA_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const col = (firestore: Firestore, name: keyof typeof COLLECTIONS) => firestore.collection(COLLECTIONS[name]);

/** A real calendar date `YYYY-MM-DD` (2026-02-30 is not one). */
function isJakartaDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = JAKARTA_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function idList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > VIOLATION_EVIDENCE_MAX_IDS) return null;
  if (!value.every((id) => typeof id === "string" && ID.test(id))) return null;
  return [...new Set(value as string[])];
}

/** The `violation` field of an openViolation request, strictly; null when anything is off. */
export function parseOpenViolation(value: unknown): OpenViolationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { reportIds, detectionHoldIds, notes, suspectedFrom, suspectedTo } = value as Record<string, unknown>;
  const reports = idList(reportIds);
  const holds = idList(detectionHoldIds);
  if (!reports || !holds) return null;
  if (!isJakartaDate(suspectedFrom) || !isJakartaDate(suspectedTo) || suspectedFrom > suspectedTo) return null;
  if (notes !== undefined && typeof notes !== "string") return null;
  const trimmed = notes?.trim() ?? "";
  if (trimmed.length > ADMIN_REASON_MAX_CHARS) return null;
  return {
    reportIds: reports,
    detectionHoldIds: holds,
    ...(trimmed ? { notes: trimmed } : {}),
    suspectedFrom,
    suspectedTo,
  };
}

/** Cases an admin still has to act on: one per place at a time. */
const ACTIVE_STATUSES = ["open", "providerNotified"] as const;

/**
 * Applies a violation action in one transaction and returns the new case id for
 * openViolation.
 */
export async function violationAction(acting: Acting, action: ViolationAction): Promise<{ violationId: string }> {
  const { firestore } = acting;
  if (action === "openViolation") {
    const input = acting.request.violation;
    // parseAction already checked the shape; this guards a missing field.
    if (!input) throw new AdminRefusal(400, "invalid_action");
    return firestore.runTransaction((tx) => openViolation(tx, acting, input));
  }
  const ref = col(firestore, "policyViolations").doc(acting.request.subjectId);
  await firestore.runTransaction((tx) => moveViolation(tx, acting, ref, action));
  return { violationId: ref.id };
}

async function openViolation(tx: Transaction, acting: Acting, input: OpenViolationInput) {
  const { firestore } = acting;
  const placeId = acting.request.subjectId;
  const reportIds = input.reportIds ?? [];
  const holdIds = input.detectionHoldIds ?? [];

  // A place is known when it has a Provider document or at least one Testimony.
  const [provider, anyTestimony, active, reports, holds] = await Promise.all([
    tx.get(col(firestore, "providers").doc(placeId)),
    tx.get(col(firestore, "testimonies").where("placeId", "==", placeId).limit(1)),
    tx.get(
      col(firestore, "policyViolations")
        .where("placeId", "==", placeId)
        .where("status", "in", [...ACTIVE_STATUSES])
        .limit(1),
    ),
    reportIds.length ? tx.getAll(...reportIds.map((id) => col(firestore, "testimonyReports").doc(id))) : [],
    holdIds.length ? tx.getAll(...holdIds.map((id) => col(firestore, "testimonies").doc(id))) : [],
  ]);
  if (!provider.exists && anyTestimony.empty) throw new AdminRefusal(404, "not_found");
  if (!active.empty) throw new AdminRefusal(409, "not_allowed");
  const belongs = (snapshot: DocumentSnapshot<unknown>) =>
    snapshot.exists && (snapshot.data() as Pick<TestimonyReportDoc | TestimonyDoc, "placeId">).placeId === placeId;
  if (!reports.every(belongs) || !holds.every(belongs)) throw new AdminRefusal(400, "invalid_action");

  const now = Timestamp.now();
  const ref = col(firestore, "policyViolations").doc();
  const doc: PolicyViolationDoc = {
    placeId,
    evidence: {
      reportIds,
      detectionHoldIds: holdIds,
      ...(input.notes ? { notes: input.notes } : {}),
      privateEvidencePaths: [],
    },
    suspectedPeriod: { from: input.suspectedFrom, to: input.suspectedTo },
    status: "open",
    openedBy: acting.admin.uid,
    createdAt: now,
    updatedAt: now,
  };
  tx.create(ref, doc);
  logAction(tx, acting, {
    subjectType: "policyViolation",
    subjectId: ref.id,
    placeId,
    toStatus: "open",
  });
  return { violationId: ref.id };
}

async function moveViolation(
  tx: Transaction,
  acting: Acting,
  ref: FirebaseFirestore.DocumentReference,
  action: Exclude<ViolationAction, "openViolation">,
) {
  const violation = (await tx.get(ref)).data() as PolicyViolationDoc | undefined;
  if (!violation) throw new AdminRefusal(404, "not_found");
  const now = Timestamp.now();
  const to = nextViolationStatus(action, violation.status, {
    nowMs: now.toMillis(),
    ...(violation.responseDueAt ? { responseDueMs: violation.responseDueAt.toMillis() } : {}),
  });
  if (!to) throw new AdminRefusal(409, "not_allowed");

  const reason = acting.request.reason as string;
  if (action === "notifyViolation") {
    const provider = (await tx.get(col(acting.firestore, "providers").doc(violation.placeId))).data() as
      | ProviderDoc
      | undefined;
    // A claimed Provider is told in its owner pages; an unclaimed one by phone through its Google listing.
    const claimed = provider?.claimStatus === "claimed";
    tx.update(ref, {
      status: to,
      notifiedAt: now,
      responseDueAt: Timestamp.fromMillis(now.toMillis() + VIOLATION_RESPONSE_DAYS * DAY_MS),
      notifiedVia: claimed ? "ownerPages" : "phone",
      ...(claimed ? {} : { phoneContactNote: reason }),
      updatedAt: now,
    });
  } else {
    tx.update(ref, {
      status: to,
      decisionReason: reason,
      decidedBy: acting.admin.uid,
      decidedAt: now,
      updatedAt: now,
    });
  }
  logAction(tx, acting, {
    subjectType: "policyViolation",
    subjectId: ref.id,
    placeId: violation.placeId,
    fromStatus: violation.status,
    toStatus: to,
  });
}

/** Cases waiting on an admin: `open` ones (24-hour target) and notified ones (due when the window ends). */
export async function loadViolationQueue(
  context: Pick<AppLoadContext, "adapters" | "logger">,
  firestore: Firestore,
  nowMs: number,
): Promise<QueueItem[]> {
  const cases = await col(firestore, "policyViolations")
    .where("status", "in", [...ACTIVE_STATUSES])
    .get();
  if (cases.empty) return [];

  const placeIds = [...new Set(cases.docs.map((doc) => doc.get("placeId") as string))];
  const providers = new Map(
    (await firestore.getAll(...placeIds.map((id) => col(firestore, "providers").doc(id))))
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot.data() as ProviderDoc] as const),
  );

  return Promise.all(
    cases.docs.map(async (doc) => {
      const violation = doc.data() as PolicyViolationDoc;
      const provider = providers.get(violation.placeId);
      const claimed = provider?.claimStatus === "claimed";
      const status = violation.status as "open" | "providerNotified";
      const windowOver = violation.responseDueAt ? nowMs >= violation.responseDueAt.toMillis() : false;

      // Live for the admin's phone call to an unclaimed Provider; shown, never stored or logged.
      let google: { googlePhone: string | null; googleDisplayName: string | null } | undefined;
      if (!claimed) {
        const block = await context.adapters.places.getGoogleBlock({ placeId: violation.placeId, language: "id" });
        context.logger.info("violation_google_phone", { outcome: block.ok ? "ok" : block.reason });
        google = {
          googlePhone: block.ok ? (block.block.nationalPhoneNumber ?? null) : null,
          googleDisplayName: block.ok ? block.block.displayName : null,
        };
      }

      const view: QueuePolicyViolation = {
        placeId: violation.placeId,
        providerName: provider?.name ?? "",
        claimed,
        status,
        evidence: {
          reportIds: violation.evidence.reportIds,
          detectionHoldIds: violation.evidence.detectionHoldIds,
          ...(violation.evidence.notes ? { notes: violation.evidence.notes } : {}),
          privateEvidenceCount: violation.evidence.privateEvidencePaths.length,
        },
        suspectedPeriod: violation.suspectedPeriod,
        ...(violation.notifiedVia ? { notifiedVia: violation.notifiedVia } : {}),
        ...(violation.phoneContactNote ? { phoneContactNote: violation.phoneContactNote } : {}),
        ...(violation.responseDueAt ? { responseDueAt: violation.responseDueAt.toDate().toISOString() } : {}),
        windowOver,
        ...(violation.providerResponse
          ? {
              providerResponse: {
                text: violation.providerResponse.text,
                respondedAt: violation.providerResponse.respondedAt.toDate().toISOString(),
              },
            }
          : {}),
        ...google,
      };
      const base = { id: doc.id, kind: "policyViolation" as const, subjectId: doc.id, violation: view };
      const item = queueItem(base, violation.createdAt, nowMs);
      // A notified case is due when the response window ends, not 24 hours after it opened.
      if (violation.status === "providerNotified" && violation.responseDueAt) {
        return { ...item, dueAt: violation.responseDueAt.toDate().toISOString(), overdue: windowOver };
      }
      return item;
    }),
  );
}
