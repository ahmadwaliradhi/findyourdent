// The admin side of Claims, owner facts and replies (spec 05, T17): queue items and
// decisions. A Claim moves submitted -> approved | rejected, approved -> revoked; its
// permit is deleted as soon as it leaves submitted. The Google listing phone the
// admin calls is fetched live for the queue and never stored.
import {
  type ClaimDoc,
  COLLECTIONS,
  type ModerationDecisionDoc,
  type ProviderDoc,
  type ProviderOwnerFacts,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import type { ApprovedClaim, OwnerAction, QueueItem, QueueModeration, QueueOwnerFactsValues } from "~/lib/admin-queue";
import { normalizeName } from "~/lib/normalize-name";
import { type Acting, AdminRefusal, iso, logAction, queueItem } from "./admin-common.server.ts";
import { computeAggregates } from "./aggregates.ts";
import { activeClaimsOf, applyOwnerFacts, deletePermit } from "./claims.server.ts";
import { inferProviderType } from "./shortlist.server.ts";
import { coordinatesFor, regionValue } from "./testimonies.server.ts";

const col = (firestore: Firestore, name: keyof typeof COLLECTIONS) => firestore.collection(COLLECTIONS[name]);

/** Approved Claims listed for revoking. */
const APPROVED_CLAIMS_SHOWN = 50;

function moderationView(decision: ModerationDecisionDoc | undefined): QueueModeration | null {
  if (!decision) return null;
  return {
    decision: decision.decision,
    ruleCodes: decision.ruleCodes,
    flaggedSpans: decision.flaggedSpans,
    confidence: decision.confidence,
    model: decision.model,
  };
}

function factsValues(facts: ProviderOwnerFacts): QueueOwnerFactsValues {
  return {
    name: facts.name,
    providerType: facts.providerType,
    region: facts.region,
    ...(facts.address ? { address: facts.address } : {}),
    ...(facts.phone ? { phone: facts.phone } : {}),
    ...(facts.whatsapp ? { whatsapp: facts.whatsapp } : {}),
    ...(facts.openingHours ? { openingHours: facts.openingHours } : {}),
    services: facts.services ?? [],
  };
}

/** Submitted Claims, held owner facts and held replies, plus approved Claims for revoking. */
export async function loadOwnerQueue(
  context: Pick<AppLoadContext, "adapters" | "logger">,
  firestore: Firestore,
  nowMs: number,
): Promise<{ items: QueueItem[]; approvedClaims: ApprovedClaim[] }> {
  const [submitted, approved, heldFacts, heldReplies] = await Promise.all([
    col(firestore, "claims").where("status", "==", "submitted").get(),
    col(firestore, "claims").where("status", "==", "approved").get(),
    col(firestore, "providers").where("pendingOwnerFacts.moderationStatus", "==", "held").get(),
    col(firestore, "testimonies").where("reply.status", "==", "held").get(),
  ]);

  const placeIds = [
    ...new Set([...submitted.docs, ...approved.docs, ...heldReplies.docs].map((doc) => doc.get("placeId") as string)),
  ];
  const decisionIds = [
    ...heldFacts.docs.map((doc) => doc.get("pendingOwnerFacts.moderationDecisionId") as string | undefined),
    ...heldReplies.docs.map((doc) => doc.get("reply.moderationDecisionId") as string | undefined),
  ].filter((id): id is string => Boolean(id));
  const [providerSnaps, decisionSnaps] = await Promise.all([
    placeIds.length ? firestore.getAll(...placeIds.map((id) => col(firestore, "providers").doc(id))) : [],
    decisionIds.length
      ? firestore.getAll(...decisionIds.map((id) => col(firestore, "moderationDecisions").doc(id)))
      : [],
  ]);
  const names = new Map(providerSnaps.filter((s) => s.exists).map((s) => [s.id, s.get("name") as string] as const));
  const decisions = new Map(decisionSnaps.map((s) => [s.id, s.data() as ModerationDecisionDoc | undefined] as const));

  const claimItems = submitted.docs.map(async (doc) => {
    const claim = doc.data() as ClaimDoc;
    // Live for the reviewer's phone call; shown, never stored or logged.
    const google = await context.adapters.places.getGoogleBlock({ placeId: claim.placeId, language: "id" });
    context.logger.info("claim_google_phone", { outcome: google.ok ? "ok" : google.reason });
    const listedName = names.get(claim.placeId);
    return queueItem(
      {
        id: doc.id,
        kind: "claim",
        subjectId: doc.id,
        claim: {
          placeId: claim.placeId,
          providerName: listedName ?? claim.proposedProviderName ?? "",
          listed: listedName !== undefined,
          role: claim.role,
          contactPhone: claim.contactPhone,
          permitUrl: claim.permitDocumentPath ? `/admin/claims/${doc.id}/permit` : null,
          googlePhone: google.ok ? (google.block.nationalPhoneNumber ?? null) : null,
          googleDisplayName: google.ok ? google.block.displayName : null,
        },
      },
      claim.createdAt,
      nowMs,
    );
  });

  const factsItems = heldFacts.docs.map((doc) => {
    const provider = doc.data() as ProviderDoc;
    const facts = provider.pendingOwnerFacts as ProviderOwnerFacts;
    return queueItem(
      {
        id: doc.id,
        kind: "ownerFacts",
        subjectId: doc.id,
        ownerFacts: {
          placeId: doc.id,
          currentName: provider.name,
          facts: factsValues(facts),
          moderation: moderationView(decisions.get(facts.moderationDecisionId ?? "")),
        },
      },
      facts.updatedAt,
      nowMs,
    );
  });

  const replyItems = heldReplies.docs.map((doc) => {
    const testimony = doc.data() as TestimonyDoc;
    const reply = testimony.reply as NonNullable<TestimonyDoc["reply"]>;
    return queueItem(
      {
        id: `reply-${doc.id}`,
        kind: "reply",
        subjectId: doc.id,
        reply: {
          testimonyId: doc.id,
          placeId: testimony.placeId,
          providerName: names.get(testimony.placeId) ?? "",
          testimonyText: testimony.text,
          text: reply.text,
          moderation: moderationView(decisions.get(reply.moderationDecisionId ?? "")),
        },
      },
      reply.updatedAt,
      nowMs,
    );
  });

  const approvedClaims: ApprovedClaim[] = approved.docs
    .map((doc) => {
      const claim = doc.data() as ClaimDoc;
      return {
        claimId: doc.id,
        placeId: claim.placeId,
        providerName: names.get(claim.placeId) ?? claim.proposedProviderName ?? "",
        ...(claim.reviewedBy ? { reviewedBy: claim.reviewedBy } : {}),
        reviewedAt: iso(claim.reviewedAt),
      };
    })
    .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    .slice(0, APPROVED_CLAIMS_SHOWN);

  return { items: [...(await Promise.all(claimItems)), ...factsItems, ...replyItems], approvedClaims };
}

/** Applies a Claim, owner-facts or reply decision and logs it in the same transaction. */
export async function ownerAction(context: AppLoadContext, acting: Acting, action: OwnerAction): Promise<void> {
  switch (action) {
    case "approveClaim":
    case "rejectClaim":
    case "revokeClaim":
      return claimAction(context, acting, action);
    case "publishOwnerFacts":
    case "rejectOwnerFacts":
      return acting.firestore.runTransaction((tx) => ownerFactsAction(tx, acting, action === "publishOwnerFacts"));
    case "publishReply":
    case "rejectReply":
      return acting.firestore.runTransaction((tx) => replyAction(tx, acting, action === "publishReply"));
  }
}

async function claimAction(
  context: AppLoadContext,
  acting: Acting,
  action: "approveClaim" | "rejectClaim" | "revokeClaim",
): Promise<void> {
  const { firestore } = acting;
  const ref = col(firestore, "claims").doc(acting.request.subjectId);
  const before = (await ref.get()).data() as ClaimDoc | undefined;
  if (!before) throw new AdminRefusal(404, "not_found");

  // A Claim on a place that is not Listed creates the Listed Provider, with coordinates fetched first.
  let location: Awaited<ReturnType<typeof coordinatesFor>> = null;
  if (action === "approveClaim" && before.status === "submitted") {
    const listed = await col(firestore, "providers").doc(before.placeId).get();
    if (!listed.exists) location = await coordinatesFor(context, before.placeId);
  }

  let permitPath: string | undefined;
  await firestore.runTransaction(async (tx) => {
    const claim = (await tx.get(ref)).data() as ClaimDoc | undefined;
    if (!claim) throw new AdminRefusal(404, "not_found");
    const from = claim.status;
    const to = action === "approveClaim" ? "approved" : action === "rejectClaim" ? "rejected" : "revoked";
    const allowed = action === "revokeClaim" ? from === "approved" : from === "submitted";
    if (!allowed) throw new AdminRefusal(409, "not_allowed");

    const provider = await tx.get(col(firestore, "providers").doc(claim.placeId));
    const now = Timestamp.now();
    if (action === "approveClaim") {
      const others = await tx.get(activeClaimsOf(firestore, claim.placeId));
      if (others.docs.some((doc) => doc.id !== ref.id && doc.get("status") === "approved")) {
        throw new AdminRefusal(409, "not_allowed");
      }
      if (provider.exists) {
        tx.update(provider.ref, { claimStatus: "claimed", claimId: ref.id, updatedAt: now });
      } else {
        if (!claim.proposedProviderName || !claim.proposedRegion) throw new AdminRefusal(409, "not_allowed");
        createListedProvider(tx, provider.ref, { claimId: ref.id, claim, location });
      }
    } else if (action === "revokeClaim" && provider.get("claimId") === ref.id) {
      // A wrong approval: the owner's facts go with it. Their replies stop showing (provider-page.server.ts).
      tx.update(provider.ref, {
        claimStatus: "unclaimed",
        claimId: FieldValue.delete(),
        ownerFacts: FieldValue.delete(),
        pendingOwnerFacts: FieldValue.delete(),
        updatedAt: now,
      });
    }

    permitPath = claim.permitDocumentPath;
    tx.update(ref, {
      status: to,
      permitDocumentPath: FieldValue.delete(),
      ...(action === "rejectClaim" && acting.request.reason ? { rejectionReason: acting.request.reason } : {}),
      reviewedBy: acting.admin.email ?? "",
      reviewedAt: now,
      updatedAt: now,
    });
    logAction(tx, acting, {
      subjectType: "claim",
      subjectId: ref.id,
      placeId: claim.placeId,
      fromStatus: from,
      toStatus: to,
    });
  });
  // Only the decision, the reviewer and the date are kept (spec 05).
  await deletePermit(context.uploads, permitPath);
}

function createListedProvider(
  tx: Transaction,
  ref: DocumentReference,
  input: { claimId: string; claim: ClaimDoc; location: Awaited<ReturnType<typeof coordinatesFor>> },
) {
  const { claim, location } = input;
  const name = claim.proposedProviderName as string;
  const now = Timestamp.now();
  const doc: ProviderDoc = {
    placeId: claim.placeId,
    name,
    nameSource: "claim",
    nameNormalized: normalizeName(name),
    region: regionValue(claim.proposedRegion as NonNullable<ClaimDoc["proposedRegion"]>),
    ...(location ? { location: { ...location, fetchedAt: now } } : {}),
    // Inferred until the owner confirms it in their facts.
    providerType: inferProviderType({ displayName: name, types: [] }),
    providerTypeSource: "inferred",
    claimStatus: "claimed",
    claimId: input.claimId,
    aggregates: computeAggregates([]),
    listedBy: "claim",
    createdAt: now,
    updatedAt: now,
  };
  tx.create(ref, doc);
}

async function ownerFactsAction(tx: Transaction, acting: Acting, publish: boolean) {
  const { firestore } = acting;
  const ref = col(firestore, "providers").doc(acting.request.subjectId);
  const provider = (await tx.get(ref)).data() as ProviderDoc | undefined;
  const facts = provider?.pendingOwnerFacts;
  if (!provider || facts?.moderationStatus !== "held") throw new AdminRefusal(404, "not_found");
  if (publish) {
    const placeTestimonies = await tx.get(col(firestore, "testimonies").where("placeId", "==", ref.id));
    applyOwnerFacts(tx, {
      provider: ref,
      facts: factsValues(facts),
      ...(facts.moderationDecisionId ? { moderationDecisionId: facts.moderationDecisionId } : {}),
      placeTestimonies,
    });
  } else {
    tx.update(ref, { pendingOwnerFacts: FieldValue.delete(), updatedAt: Timestamp.now() });
  }
  logAction(tx, acting, {
    action: publish ? "publish" : "reject",
    subjectType: "providerFacts",
    subjectId: ref.id,
    placeId: ref.id,
    fromStatus: "held",
    toStatus: publish ? "published" : "rejected",
  });
}

async function replyAction(tx: Transaction, acting: Acting, publish: boolean) {
  const ref = col(acting.firestore, "testimonies").doc(acting.request.subjectId);
  const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
  if (testimony?.reply?.status !== "held") throw new AdminRefusal(404, "not_found");
  const provider = (await tx.get(col(acting.firestore, "providers").doc(testimony.placeId))).data() as
    | ProviderDoc
    | undefined;
  // A reply written under a Claim since revoked never goes live.
  if (publish && provider?.claimId !== testimony.reply.claimId) throw new AdminRefusal(409, "not_allowed");
  const to = publish ? "published" : "rejected";
  tx.update(ref, { "reply.status": to, "reply.updatedAt": Timestamp.now() });
  logAction(tx, acting, {
    action: publish ? "publish" : "reject",
    subjectType: "reply",
    subjectId: ref.id,
    placeId: testimony.placeId,
    fromStatus: "held",
    toStatus: to,
  });
}
