// The admin queue (spec 03, T14): held Testimonies, held edits of published ones,
// reports, name corrections and the 10% spot-check sample, with the admin actions
// on them. Only allowlisted admins get here (the Express gate in server/auth.ts);
// every action is checked against the state machine (testimony-state.ts) and logged
// in `adminActions` inside the same transaction as the change it records.
import {
  type AdminActionDoc,
  type AdminActionType,
  COLLECTIONS,
  type ModerationDecisionDoc,
  type NameCorrectionDoc,
  type ProviderDoc,
  type Timestamp as StoredTimestamp,
  type TestimonyContent,
  type TestimonyDoc,
  type TestimonyReportDoc,
  type TestimonyStatus,
} from "@findyourdent/contracts/firestore";
import {
  type DocumentReference,
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  type QuerySnapshot,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import {
  ADMIN_REASON_MAX_CHARS,
  type AdminActionRequest,
  type AdminActionResponse,
  type AdminApiError,
  type AdminQueueResponse,
  QUEUE_TARGET_HOURS,
  type QueueHistoryEntry,
  type QueueItem,
  type QueueModeration,
  type QueueTestimony,
  type QueueTestimonyContent,
  REASON_REQUIRED,
  TESTIMONY_ACTIONS,
  type TestimonyAction,
} from "~/lib/admin-queue";
import { normalizeName } from "~/lib/normalize-name";
import { testimonyPhotoUrl } from "~/lib/testimony-photos";
import type { LatLng } from "../../server/adapters/places.ts";
import type { SignedInUser } from "../../server/auth.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import {
  coordinatesFor,
  publishedOf,
  regionValue,
  storedPhotoPaths,
  writeProviderOnPublish,
  writeProviderOnUnpublish,
} from "./testimonies.server.ts";
import { deleteTestimonyMedia } from "./testimony-media.server.ts";
import { canTransition } from "./testimony-state.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET_MS = QUEUE_TARGET_HOURS * 60 * 60 * 1000;

const col = (firestore: Firestore, name: keyof typeof COLLECTIONS) => firestore.collection(COLLECTIONS[name]);
const iso = (time: StoredTimestamp | undefined) => (time ? time.toDate().toISOString() : new Date(0).toISOString());

// Queue ------------------------------------------------------------------------------

function contentView(testimonyId: string, content: TestimonyContent, displayName: string): QueueTestimonyContent {
  return {
    ratings: content.ratings,
    text: content.text,
    visitMonth: content.visitMonth,
    ...(content.procedureCode ? { procedureCode: content.procedureCode } : {}),
    ...(content.pricePaidRupiah !== undefined ? { pricePaidRupiah: content.pricePaidRupiah } : {}),
    displayName,
    photoUrls: content.photoPaths.map((path) => testimonyPhotoUrl(testimonyId, path)),
  };
}

function moderationView(decision: ModerationDecisionDoc | undefined): QueueModeration | null {
  if (!decision) return null;
  return {
    decision: decision.decision,
    ruleCodes: decision.ruleCodes,
    flaggedSpans: decision.flaggedSpans,
    ...(decision.flaggedPhotos ? { flaggedPhotos: decision.flaggedPhotos } : {}),
    confidence: decision.confidence,
    model: decision.model,
  };
}

/** Moderation decisions, reports and admin actions on one Testimony, oldest first. */
async function historyOf(firestore: Firestore, testimonyId: string): Promise<QueueHistoryEntry[]> {
  const [decisions, reports, actions] = await Promise.all([
    col(firestore, "moderationDecisions").where("subjectId", "==", testimonyId).get(),
    col(firestore, "testimonyReports").where("testimonyId", "==", testimonyId).get(),
    col(firestore, "adminActions").where("subjectId", "==", testimonyId).get(),
  ]);
  const entries: Array<QueueHistoryEntry & { ms: number }> = [
    ...decisions.docs.map((doc) => {
      const d = doc.data() as ModerationDecisionDoc;
      const detail = [d.subjectType === "testimonyRevision" ? "edit" : "", ...d.ruleCodes].filter(Boolean).join(", ");
      return {
        ms: d.decidedAt.toMillis(),
        at: iso(d.decidedAt),
        kind: "moderation" as const,
        label: d.decision,
        detail,
      };
    }),
    ...reports.docs.map((doc) => {
      const r = doc.data() as TestimonyReportDoc;
      return {
        ms: r.createdAt.toMillis(),
        at: iso(r.createdAt),
        kind: "report" as const,
        label: r.category,
        ...(r.details ? { detail: r.details } : {}),
      };
    }),
    ...actions.docs.map((doc) => {
      const a = doc.data() as AdminActionDoc;
      return {
        ms: a.createdAt.toMillis(),
        at: iso(a.createdAt),
        kind: "admin" as const,
        label: a.action,
        ...(a.reason ? { detail: a.reason } : {}),
        by: a.adminEmail,
      };
    }),
  ];
  return entries.sort((a, b) => a.ms - b.ms).map(({ ms: _ms, ...entry }) => entry);
}

function item(
  base: Omit<QueueItem, "createdAt" | "dueAt" | "overdue">,
  enteredAt: StoredTimestamp | undefined,
  nowMs: number,
): QueueItem {
  const ms = enteredAt?.toMillis() ?? 0;
  return {
    ...base,
    createdAt: iso(enteredAt),
    dueAt: new Date(ms + TARGET_MS).toISOString(),
    overdue: nowMs > ms + TARGET_MS,
  };
}

/** Everything waiting for an admin: Testimonies hidden by a report first, then oldest first. */
export async function loadAdminQueue(firestore: Firestore, nowMs = Date.now()): Promise<AdminQueueResponse> {
  const [held, revisions, reports, corrections, spotChecks] = await Promise.all([
    col(firestore, "testimonies").where("status", "==", "held").get(),
    col(firestore, "testimonies").where("pendingRevision.status", "==", "held").get(),
    col(firestore, "testimonyReports").where("status", "==", "open").get(),
    col(firestore, "nameCorrections").where("status", "==", "open").get(),
    col(firestore, "moderationDecisions").where("spotCheck", "==", true).where("spotCheckReviewed", "==", false).get(),
  ]);

  const testimonies = new Map<string, TestimonyDoc>();
  for (const doc of [...held.docs, ...revisions.docs]) testimonies.set(doc.id, doc.data() as TestimonyDoc);
  const reportsByTestimony = new Map<string, Array<{ id: string; report: TestimonyReportDoc }>>();
  for (const doc of reports.docs) {
    const report = doc.data() as TestimonyReportDoc;
    reportsByTestimony.set(report.testimonyId, [
      ...(reportsByTestimony.get(report.testimonyId) ?? []),
      { id: doc.id, report },
    ]);
  }
  const missing = [
    ...new Set([...reportsByTestimony.keys(), ...spotChecks.docs.map((doc) => doc.get("subjectId") as string)]),
  ].filter((id) => !testimonies.has(id));
  if (missing.length) {
    const snapshots = await firestore.getAll(...missing.map((id) => col(firestore, "testimonies").doc(id)));
    for (const snapshot of snapshots) {
      if (snapshot.exists) testimonies.set(snapshot.id, snapshot.data() as TestimonyDoc);
    }
  }

  const placeIds = [...new Set([...testimonies.values()].map((t) => t.placeId))];
  const decisionIds = [
    ...new Set(
      [...testimonies.values()]
        .map((t) => t.pendingRevision?.moderationDecisionId ?? t.moderationDecisionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [providerSnaps, decisionSnaps] = await Promise.all([
    placeIds.length ? firestore.getAll(...placeIds.map((id) => col(firestore, "providers").doc(id))) : [],
    decisionIds.length
      ? firestore.getAll(...decisionIds.map((id) => col(firestore, "moderationDecisions").doc(id)))
      : [],
  ]);
  const names = new Map(providerSnaps.filter((s) => s.exists).map((s) => [s.id, s.get("name") as string] as const));
  const decisions = new Map(decisionSnaps.map((s) => [s.id, s.data() as ModerationDecisionDoc | undefined] as const));

  const views = new Map<string, Promise<QueueTestimony>>();
  const view = (id: string): Promise<QueueTestimony> => {
    let pending = views.get(id);
    if (!pending) {
      const t = testimonies.get(id) as TestimonyDoc;
      pending = historyOf(firestore, id).then((history) => {
        const listedName = names.get(t.placeId);
        const revision = t.pendingRevision?.status === "held" ? t.pendingRevision : undefined;
        return {
          id,
          placeId: t.placeId,
          providerName: listedName ?? t.proposedProviderName ?? "",
          listed: listedName !== undefined,
          status: t.status,
          verifiedVisit: t.verifiedVisit === true,
          ...(t.adminReason ? { adminReason: t.adminReason } : {}),
          ...contentView(id, t, t.displayName),
          ...(revision ? { revision: contentView(id, revision, revision.displayName ?? t.displayName) } : {}),
          moderation: moderationView(
            decisions.get(t.pendingRevision?.moderationDecisionId ?? t.moderationDecisionId ?? ""),
          ),
          history,
        };
      });
      views.set(id, pending);
    }
    return pending;
  };

  const items: Array<Promise<QueueItem>> = [];
  for (const doc of held.docs) {
    const t = testimonies.get(doc.id) as TestimonyDoc;
    items.push(
      view(doc.id).then((testimony) =>
        item({ id: doc.id, kind: "held", subjectId: doc.id, testimony }, t.updatedAt, nowMs),
      ),
    );
  }
  for (const doc of revisions.docs) {
    const t = testimonies.get(doc.id) as TestimonyDoc;
    // Only a published Testimony keeps a pending revision; anything else is a held Testimony above.
    if (t.status !== "published") continue;
    items.push(
      view(doc.id).then((testimony) =>
        item({ id: doc.id, kind: "revision", subjectId: doc.id, testimony }, t.pendingRevision?.submittedAt, nowMs),
      ),
    );
  }
  for (const [testimonyId, list] of reportsByTestimony) {
    if (!testimonies.has(testimonyId)) continue;
    const oldest = list.reduce((a, b) => (a.report.createdAt.toMillis() <= b.report.createdAt.toMillis() ? a : b));
    items.push(
      view(testimonyId).then((testimony) =>
        item(
          {
            id: testimonyId,
            kind: "report",
            subjectId: testimonyId,
            testimony,
            reports: list.map(({ id, report }) => ({
              id,
              category: report.category,
              ...(report.details ? { details: report.details } : {}),
              hidTestimony: report.hidTestimony,
              createdAt: iso(report.createdAt),
            })),
          },
          oldest.report.createdAt,
          nowMs,
        ),
      ),
    );
  }
  for (const doc of spotChecks.docs) {
    const decision = doc.data() as ModerationDecisionDoc;
    // Spot-check what the public sees: a Testimony since hidden, removed or deleted has left that.
    if (testimonies.get(decision.subjectId)?.status !== "published") continue;
    items.push(
      view(decision.subjectId).then((testimony) =>
        item({ id: doc.id, kind: "spotCheck", subjectId: decision.subjectId, testimony }, decision.decidedAt, nowMs),
      ),
    );
  }
  for (const doc of corrections.docs) {
    const c = doc.data() as NameCorrectionDoc;
    items.push(
      Promise.resolve(
        item(
          {
            id: doc.id,
            kind: "nameCorrection",
            subjectId: doc.id,
            correction: {
              placeId: c.placeId,
              currentName: c.currentName,
              currentRegion: c.currentRegion,
              ...(c.suggestedName ? { suggestedName: c.suggestedName } : {}),
              ...(c.suggestedRegion ? { suggestedRegion: c.suggestedRegion } : {}),
            },
          },
          c.createdAt,
          nowMs,
        ),
      ),
    );
  }

  const resolved = await Promise.all(items);
  const hiddenFirst = (i: QueueItem) => (i.kind === "report" && i.testimony?.status === "hidden" ? 0 : 1);
  resolved.sort((a, b) => hiddenFirst(a) - hiddenFirst(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { items: resolved };
}

// Actions ----------------------------------------------------------------------------

class AdminRefusal extends Error {
  readonly status: number;
  readonly code: AdminApiError["error"];

  constructor(status: number, code: AdminApiError["error"]) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function errorResponse(request: Request, status: number, error: AdminApiError["error"]) {
  const language = await detectLanguage(request);
  const message = getI18n(language).getFixedT(language)(`adminApi.errors.${error}`);
  const body: AdminApiError = { error, message };
  return Response.json(body, { status });
}

const ACTIONS: ReadonlySet<string> = new Set<AdminActionRequest["action"]>([
  ...TESTIMONY_ACTIONS,
  "dismissReport",
  "applyNameCorrection",
  "dismissNameCorrection",
  "spotCheckConfirm",
]);

function parseAction(body: unknown): AdminActionRequest | null {
  if (!body || typeof body !== "object") return null;
  const { action, subjectId, reason } = body as Record<string, unknown>;
  if (typeof action !== "string" || !ACTIONS.has(action)) return null;
  if (typeof subjectId !== "string" || !ID.test(subjectId)) return null;
  if (reason !== undefined && typeof reason !== "string") return null;
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length > ADMIN_REASON_MAX_CHARS) return null;
  return { action: action as AdminActionRequest["action"], subjectId, ...(trimmed ? { reason: trimmed } : {}) };
}

interface Acting {
  firestore: Firestore;
  admin: SignedInUser;
  request: AdminActionRequest;
  actionRef: DocumentReference;
}

function logAction(
  tx: Transaction,
  acting: Acting,
  entry: Omit<AdminActionDoc, "action" | "adminEmail" | "adminUid" | "createdAt" | "reason">,
) {
  const doc: AdminActionDoc = {
    action: acting.request.action as AdminActionType,
    ...entry,
    adminEmail: acting.admin.email ?? "",
    adminUid: acting.admin.uid,
    ...(acting.request.reason ? { reason: acting.request.reason } : {}),
    createdAt: Timestamp.now(),
  };
  tx.create(acting.actionRef, doc);
}

/** POST /admin/api/actions: one admin decision, applied and logged together. */
export async function adminActionResponse(context: AppLoadContext, request: Request): Promise<Response> {
  const { admin, firestore } = context;
  if (!admin) return errorResponse(request, 403, "not_allowed");
  if (!firestore) return errorResponse(request, 503, "unavailable");
  let parsed: AdminActionRequest | null;
  try {
    parsed = parseAction(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return errorResponse(request, 400, "invalid_action");
  if (REASON_REQUIRED.has(parsed.action) && !parsed.reason) return errorResponse(request, 400, "reason_required");

  const acting: Acting = { firestore, admin, request: parsed, actionRef: col(firestore, "adminActions").doc() };
  try {
    switch (parsed.action) {
      case "dismissReport":
        await firestore.runTransaction((tx) => dismissReport(tx, acting));
        break;
      case "applyNameCorrection":
      case "dismissNameCorrection":
        await firestore.runTransaction((tx) => resolveNameCorrection(tx, acting));
        break;
      case "spotCheckConfirm":
        await firestore.runTransaction((tx) => confirmSpotCheck(tx, acting));
        break;
      default: {
        const orphaned = await testimonyAction(context, acting, parsed.action);
        if (context.uploads) await deleteTestimonyMedia(context.uploads, orphaned);
      }
    }
  } catch (error) {
    if (!(error instanceof AdminRefusal)) throw error;
    return errorResponse(request, error.status, error.code);
  }

  context.logger.info("admin_action", { action: parsed.action });
  const body: AdminActionResponse = { ok: true, actionId: acting.actionRef.id };
  return Response.json(body);
}

const TARGET_STATUS: Record<TestimonyAction, TestimonyStatus> = {
  publish: "published",
  reject: "rejected",
  sendBackToAuthor: "needsAuthorFix",
  hide: "hidden",
  remove: "removed",
};

/** Reasons shown to the author (`adminReason`); a hide reason stays in the log only. */
const AUTHOR_SEES_REASON: ReadonlySet<TestimonyAction> = new Set(["reject", "sendBackToAuthor", "remove"]);

/** Applies a Testimony action and returns stored photo paths no version uses any more. */
async function testimonyAction(context: AppLoadContext, acting: Acting, action: TestimonyAction): Promise<string[]> {
  const { firestore } = acting;
  const ref = col(firestore, "testimonies").doc(acting.request.subjectId);

  // A first publish of a place that is not Listed needs coordinates, fetched before the transaction.
  let location: LatLng | null = null;
  const before = (await ref.get()).data() as TestimonyDoc | undefined;
  if (action === "publish" && before?.status === "held" && before.proposedProviderName) {
    const listed = await col(firestore, "providers").doc(before.placeId).get();
    if (!listed.exists) location = await coordinatesFor(context, before.placeId);
  }

  let orphaned: string[] = [];
  await firestore.runTransaction(async (tx) => {
    const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
    if (!testimony || testimony.status === "deleted") throw new AdminRefusal(404, "not_found");
    const revision =
      testimony.status === "published" && testimony.pendingRevision?.status === "held"
        ? testimony.pendingRevision
        : null;
    if (revision && (action === "publish" || action === "reject" || action === "sendBackToAuthor")) {
      orphaned = await revisionAction(tx, acting, { ref, testimony, revision, action });
      return;
    }

    const from = testimony.status;
    const to = TARGET_STATUS[action];
    if (!canTransition(from, to, "admin")) throw new AdminRefusal(409, "not_allowed");
    const publicChanges = from === "published" || to === "published";
    const provider = publicChanges ? await tx.get(col(firestore, "providers").doc(testimony.placeId)) : null;
    const published = publicChanges ? await tx.get(publishedOf(firestore, testimony.placeId)) : null;
    const resolution = to === "published" ? "kept" : to === "removed" ? "removed" : null;
    const openReports = resolution ? await tx.get(openReportsOf(firestore, ref.id)) : null;

    const now = Timestamp.now();
    const update: Record<string, unknown> = { status: to, updatedAt: now };
    if (acting.request.reason && AUTHOR_SEES_REASON.has(action)) update.adminReason = acting.request.reason;
    if (provider && published && to === "published") {
      const { region, providerType } = writeProviderOnPublish(tx, {
        placeId: testimony.placeId,
        provider,
        published,
        testimonyId: ref.id,
        self: testimony,
        proposal: testimony.proposedProviderName
          ? {
              name: testimony.proposedProviderName,
              region: testimony.region,
              providerType: testimony.providerType,
              location,
            }
          : null,
      });
      update.region = regionValue(region);
      update.providerType = providerType;
      update.proposedProviderName = FieldValue.delete();
      if (!testimony.publishedAt) update.publishedAt = now;
    } else if (provider && published) {
      writeProviderOnUnpublish(tx, provider, published, ref.id);
    }
    tx.update(ref, update);
    recordTestimonyTransition(
      firestore,
      tx,
      { status: from, verifiedVisit: testimony.verifiedVisit },
      { status: to, verifiedVisit: testimony.verifiedVisit },
    );
    for (const report of openReports?.docs ?? []) {
      tx.update(report.ref, { status: "resolved", resolution, resolvedBy: acting.admin.email ?? "", resolvedAt: now });
    }
    logAction(tx, acting, {
      subjectType: "testimony",
      subjectId: ref.id,
      placeId: testimony.placeId,
      fromStatus: from,
      toStatus: to,
    });
  });
  return orphaned;
}

const openReportsOf = (firestore: Firestore, testimonyId: string) =>
  col(firestore, "testimonyReports").where("testimonyId", "==", testimonyId).where("status", "==", "open");

/**
 * A held edit of a published Testimony: publish replaces the public version, reject
 * drops the edit (the public version stays), send back lets the author fix the edit.
 */
async function revisionAction(
  tx: Transaction,
  acting: Acting,
  input: {
    ref: DocumentReference;
    testimony: TestimonyDoc;
    revision: NonNullable<TestimonyDoc["pendingRevision"]>;
    action: "publish" | "reject" | "sendBackToAuthor";
  },
): Promise<string[]> {
  const { firestore } = acting;
  const { ref, testimony, revision, action } = input;
  const now = Timestamp.now();
  let orphaned: string[] = [];
  let toStatus: string;
  if (action === "publish") {
    const provider = await tx.get(col(firestore, "providers").doc(testimony.placeId));
    const published = await tx.get(publishedOf(firestore, testimony.placeId));
    const content: TestimonyContent = revision;
    writeProviderOnPublish(tx, {
      placeId: testimony.placeId,
      provider,
      published,
      testimonyId: ref.id,
      self: { ...content, verifiedVisit: testimony.verifiedVisit },
      proposal: null,
    });
    tx.update(ref, {
      ratings: content.ratings,
      text: content.text,
      visitMonth: content.visitMonth,
      procedureCode: content.procedureCode ?? FieldValue.delete(),
      pricePaidRupiah: content.pricePaidRupiah ?? FieldValue.delete(),
      photoPaths: content.photoPaths,
      displayName: revision.displayName ?? testimony.displayName,
      ...(revision.moderationDecisionId ? { moderationDecisionId: revision.moderationDecisionId } : {}),
      pendingRevision: FieldValue.delete(),
      updatedAt: now,
    });
    const kept = new Set(content.photoPaths);
    orphaned = storedPhotoPaths(testimony).filter((path) => !kept.has(path));
    toStatus = "published";
  } else if (action === "reject") {
    tx.update(ref, {
      pendingRevision: FieldValue.delete(),
      ...(acting.request.reason ? { adminReason: acting.request.reason } : {}),
      updatedAt: now,
    });
    const kept = new Set(testimony.photoPaths);
    orphaned = revision.photoPaths.filter((path) => !kept.has(path));
    toStatus = "rejected";
  } else {
    tx.update(ref, {
      "pendingRevision.status": "needsAuthorFix",
      ...(acting.request.reason ? { adminReason: acting.request.reason } : {}),
      updatedAt: now,
    });
    toStatus = "needsAuthorFix";
  }
  logAction(tx, acting, {
    subjectType: "testimony",
    subjectId: ref.id,
    placeId: testimony.placeId,
    fromStatus: "pendingRevision.held",
    toStatus: `pendingRevision.${toStatus}`,
  });
  return orphaned;
}

async function dismissReport(tx: Transaction, acting: Acting) {
  const ref = col(acting.firestore, "testimonyReports").doc(acting.request.subjectId);
  const report = (await tx.get(ref)).data() as TestimonyReportDoc | undefined;
  if (report?.status !== "open") throw new AdminRefusal(404, "not_found");
  const testimony = (await tx.get(col(acting.firestore, "testimonies").doc(report.testimonyId))).data() as
    | TestimonyDoc
    | undefined;
  // A Testimony hidden by a report is decided by publishing or removing it, not by dismissing.
  if (testimony?.status === "hidden") throw new AdminRefusal(409, "not_allowed");
  tx.update(ref, {
    status: "resolved",
    resolution: "dismissed",
    resolvedBy: acting.admin.email ?? "",
    resolvedAt: Timestamp.now(),
  });
  logAction(tx, acting, {
    subjectType: "testimonyReport",
    subjectId: ref.id,
    placeId: report.placeId,
    fromStatus: "open",
    toStatus: "resolved",
  });
}

async function resolveNameCorrection(tx: Transaction, acting: Acting) {
  const { firestore } = acting;
  const ref = col(firestore, "nameCorrections").doc(acting.request.subjectId);
  const correction = (await tx.get(ref)).data() as NameCorrectionDoc | undefined;
  if (correction?.status !== "open") throw new AdminRefusal(404, "not_found");
  const applying = acting.request.action === "applyNameCorrection";
  let provider: DocumentSnapshot | null = null;
  let placeTestimonies: QuerySnapshot | null = null;
  if (applying) {
    provider = await tx.get(col(firestore, "providers").doc(correction.placeId));
    if (!provider.exists) throw new AdminRefusal(404, "not_found");
    if (correction.suggestedRegion) {
      placeTestimonies = await tx.get(col(firestore, "testimonies").where("placeId", "==", correction.placeId));
    }
  }

  const now = Timestamp.now();
  if (provider) {
    const update: Partial<Record<keyof ProviderDoc, unknown>> = { updatedAt: now };
    if (correction.suggestedName) {
      update.name = correction.suggestedName;
      update.nameNormalized = normalizeName(correction.suggestedName);
    }
    if (correction.suggestedRegion) update.region = regionValue(correction.suggestedRegion);
    tx.update(provider.ref, update);
    // Testimonies copy the Region for feed filters (spec 04).
    for (const doc of placeTestimonies?.docs ?? []) {
      if (doc.get("status") === "deleted" || !correction.suggestedRegion) continue;
      tx.update(doc.ref, { region: regionValue(correction.suggestedRegion) });
    }
  }
  const status = applying ? "applied" : "dismissed";
  tx.update(ref, { status, resolvedBy: acting.admin.email ?? "", resolvedAt: now });
  logAction(tx, acting, {
    subjectType: "nameCorrection",
    subjectId: ref.id,
    placeId: correction.placeId,
    fromStatus: "open",
    toStatus: status,
  });
}

async function confirmSpotCheck(tx: Transaction, acting: Acting) {
  const ref = col(acting.firestore, "moderationDecisions").doc(acting.request.subjectId);
  const decision = (await tx.get(ref)).data() as ModerationDecisionDoc | undefined;
  if (!decision?.spotCheck || decision.spotCheckReviewed !== false) throw new AdminRefusal(404, "not_found");
  tx.update(ref, { spotCheckReviewed: true });
  logAction(tx, acting, {
    subjectType: "moderationDecision",
    subjectId: ref.id,
    placeId: decision.placeId,
  });
}
