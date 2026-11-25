// Testimony Policy Violation cases (spec 09 part 2, issue #137): the admin opens a case
// on a Provider with its evidence, notifies the Provider, and after the 7-day window
// confirms or dismisses it. Every move is logged in `adminActions` in the transaction
// that applies it (`logAction`). Confirming (issue #138) also, in that transaction, marks
// the place's Testimonies published in the suspected period `excludedByViolation`,
// recomputes the Provider's aggregates without them and puts the 6-month badge on the
// Provider; the badge end job is server/violation-badge-expiry.ts. The pure move rule is
// in lib/policy-violations.ts.
import {
  COLLECTIONS,
  type PolicyViolationDoc,
  type ProviderDoc,
  type TestimonyDoc,
  type TestimonyReportDoc,
} from "@findyourdent/contracts/firestore";
import {
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import {
  ADMIN_REASON_MAX_CHARS,
  type OpenViolationInput,
  type QueueItem,
  type QueuePolicyViolation,
  VIOLATION_EVIDENCE_MAX_IDS,
  type ViolationAction,
} from "~/lib/admin-queue";
import { badgeUntilMs, DAY_MS, nextViolationStatus, VIOLATION_RESPONSE_DAYS } from "~/lib/policy-violations";
import { jakartaDate } from "../../server/quota.ts";
import { type Acting, AdminRefusal, logAction, queueItem, SUBJECT_ID } from "./admin-common.server.ts";
import { computeAggregates } from "./aggregates.ts";
import { hasApprovedClaim } from "./claims.server.ts";

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
  if (!value.every((id) => typeof id === "string" && SUBJECT_ID.test(id))) return null;
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
  const { reportIds, detectionHoldIds: holdIds } = input;

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
  // Every read of a confirm comes before its first write.
  const confirmation =
    action === "confirmViolation" ? await readConfirmation(tx, acting.firestore, ref.id, violation) : null;
  if (confirmation) {
    const badgeUntil = Timestamp.fromMillis(badgeUntilMs(now.toMillis()));
    for (const doc of confirmation.excluded) tx.update(doc.ref, { excludedByViolation: ref.id, updatedAt: now });
    if (confirmation.provider) {
      tx.update(confirmation.provider.ref, {
        aggregates: computeAggregates(confirmation.publishedAfter),
        violationBadge: { violationId: ref.id, badgeUntil },
        updatedAt: now,
      });
    }
    tx.update(ref, {
      status: to,
      decisionReason: reason,
      decidedBy: acting.admin.uid,
      decidedAt: now,
      badgeUntil,
      excludedTestimonyIds: confirmation.excluded.map((doc) => doc.id),
      updatedAt: now,
    });
  } else if (action === "notifyViolation") {
    const provider = (await tx.get(col(acting.firestore, "providers").doc(violation.placeId))).data() as
      | ProviderDoc
      | undefined;
    // A claimed Provider (an approved Claim, as the owner pages check it) is told in its owner pages;
    // an unclaimed one by phone through its Google listing.
    const claimed = await hasApprovedClaim(acting.firestore, provider?.claimId, tx);
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

/**
 * What a confirm reads: the place's Testimonies (any status), those published inside the
 * suspected period (Jakarta dates, both ends inclusive) to mark, and the Provider document
 * when there is one.
 */
async function readConfirmation(
  tx: Transaction,
  firestore: Firestore,
  violationId: string,
  violation: PolicyViolationDoc,
) {
  const [testimonies, provider] = await Promise.all([
    tx.get(col(firestore, "testimonies").where("placeId", "==", violation.placeId)),
    tx.get(col(firestore, "providers").doc(violation.placeId)),
  ]);
  const { from, to } = violation.suspectedPeriod;
  const inPeriod = (doc: QueryDocumentSnapshot) => {
    const { publishedAt, excludedByViolation } = doc.data() as TestimonyDoc;
    // One already excluded by an earlier case keeps that mark.
    if (!publishedAt || excludedByViolation) return false;
    const day = jakartaDate(publishedAt.toMillis());
    return day >= from && day <= to;
  };
  const excluded = testimonies.docs.filter(inPeriod);
  const excludedIds = new Set(excluded.map((doc) => doc.id));
  return {
    excluded,
    provider: provider.exists ? provider : null,
    /** The published Testimonies as they are once the period's ones carry the mark. */
    publishedAfter: testimonies.docs
      .map((doc) => ({ doc, data: doc.data() as TestimonyDoc }))
      .filter(({ data }) => data.status === "published")
      .map(({ doc, data }) => (excludedIds.has(doc.id) ? { ...data, excludedByViolation: violationId } : data)),
  };
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
      const claimed = await hasApprovedClaim(firestore, provider?.claimId);
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
