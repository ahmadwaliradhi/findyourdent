// Admin proof review (spec 09, ticket #129): a Proof of Visit the decision sent to the
// team waits in the admin queue with its private file, the facts the agent read and the
// reasons, and with the Testimonies whose Proof Fingerprints match it (ticket #130). An
// admin accepts it (the Testimony becomes Proven, the fingerprint stays) or rejects it
// with a note the author reads (the fingerprint goes); either way its file goes. Nobody
// deciding within 7 days is the proof expiry job's business (server/proof-expiry.ts):
// never an accept.
import {
  COLLECTIONS,
  type ProofFingerprintDoc,
  type ProofOfVisitRecord,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import type { ProofAction, QueueItem, QueueProofMatch } from "~/lib/admin-queue";
import type { Bucket } from "../../server/firebase.ts";
import { deleteProofFile, isPdfProof } from "../../server/proof-files.ts";
import { decidedRecord, rejectWaitingProof } from "../../server/waiting-proof.ts";
import { type Acting, AdminRefusal, iso, logAction, queueItem } from "./admin-common.server.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import { matchingTestimonyIds, placeFingerprints } from "./proof-fingerprint.server.ts";
import { publishedOf, writeProviderOnPublish } from "./testimonies.server.ts";

const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const testimonies = (firestore: Firestore) => firestore.collection(COLLECTIONS.testimonies);

/** The admin-only route that streams a waiting proof file. */
export const proofFileUrl = (testimonyId: string) => `/admin/proofs/${testimonyId}`;

/** The file a waiting proof names, or null when there is no waiting proof. */
function waitingFilePath(testimony: TestimonyDoc | undefined): string | null {
  const proof = testimony?.status === "deleted" ? undefined : testimony?.proofOfVisit;
  return proof?.result === "pending" ? (proof.filePath ?? null) : null;
}

/** The waiting proof's file while it is stored, else null (the 7-day lifecycle rule deleted it). */
async function storedWaitingFile(uploads: Bucket | null, testimony: TestimonyDoc): Promise<string | null> {
  const path = waitingFilePath(testimony);
  if (!uploads || !path) return null;
  const [exists] = await uploads.file(path).exists();
  return exists ? path : null;
}

/**
 * GET /admin/proofs/:testimonyId: streams the file of a waiting proof to an allowlisted
 * admin (the Express gate refuses everyone else first). 404 once there is none: decided,
 * expired, or deleted by the bucket's 7-day lifecycle rule.
 */
export async function proofFileResponse(context: AppLoadContext, testimonyId: string | undefined): Promise<Response> {
  if (!context.admin) return new Response(null, { status: 403 });
  if (!testimonyId || !TESTIMONY_ID.test(testimonyId)) return new Response(null, { status: 404 });
  const { firestore, uploads } = context;
  if (!firestore || !uploads) return new Response(null, { status: 404 });
  const snapshot = await testimonies(firestore).doc(testimonyId).get();
  const path = waitingFilePath(snapshot.data() as TestimonyDoc | undefined);
  if (!path) return new Response(null, { status: 404 });
  let bytes: Buffer;
  try {
    [bytes] = await uploads.file(path).download();
  } catch {
    // Gone: the lifecycle rule deleted it, or the proof was decided meanwhile.
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": isPdfProof(path) ? "application/pdf" : "image/jpeg",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Every Proof of Visit waiting for the team, entered into the queue when it was checked.
 * Equality only on `proofOfVisit.result`: no composite index.
 */
export async function loadProofQueue(
  context: Pick<AppLoadContext, "uploads">,
  firestore: Firestore,
  nowMs: number,
): Promise<QueueItem[]> {
  const pending = await testimonies(firestore).where("proofOfVisit.result", "==", "pending").get();
  // Erasure takes the proof record; a Testimony deleted before it did has nothing to decide.
  const docs = pending.docs.filter((doc) => doc.get("status") !== "deleted");
  if (docs.length === 0) return [];

  const placeIds = [...new Set(docs.map((doc) => doc.get("placeId") as string))];
  const providers = await firestore.getAll(
    ...placeIds.map((id) => firestore.collection(COLLECTIONS.providers).doc(id)),
  );
  const names = new Map(providers.filter((s) => s.exists).map((s) => [s.id, (s.data() as ProviderDoc).name] as const));

  const matches = await matchingTestimonies(firestore, docs);

  return Promise.all(
    docs.map(async (doc) => {
      const t = doc.data() as TestimonyDoc;
      const proof = t.proofOfVisit as ProofOfVisitRecord;
      const listedName = names.get(t.placeId);
      const path = await storedWaitingFile(context.uploads, t);
      return queueItem(
        {
          id: `proof-${doc.id}`,
          kind: "proof",
          subjectId: doc.id,
          proof: {
            testimonyId: doc.id,
            placeId: t.placeId,
            providerName: listedName ?? t.proposedProviderName ?? "",
            listed: listedName !== undefined,
            testimonyStatus: t.status,
            checkedAt: iso(proof.checkedAt),
            visitMonth: t.visitMonth,
            displayName: t.displayName,
            fileUrl: path ? proofFileUrl(doc.id) : null,
            ...(path ? { fileType: isPdfProof(path) ? ("pdf" as const) : ("image" as const) } : {}),
            ...(proof.clinicNameOnProof ? { clinicNameOnProof: proof.clinicNameOnProof } : {}),
            ...(proof.proofDate ? { proofDate: proof.proofDate } : {}),
            ...(proof.totalRupiah !== undefined ? { totalRupiah: proof.totalRupiah } : {}),
            reasons: proof.reasons ?? [],
            attempts: proof.attempts ?? 1,
            matchingTestimonies: matches.get(doc.id) ?? [],
          },
        },
        proof.checkedAt,
        nowMs,
      );
    }),
  );
}

/**
 * For each waiting proof, the other Testimonies whose Proof Fingerprints match its own:
 * the reuse check's comparison run again when the queue loads, so a match deleted since
 * is gone and a later copy of the receipt shows up. One equality query per place.
 */
async function matchingTestimonies(
  firestore: Firestore,
  docs: QueryDocumentSnapshot[],
): Promise<Map<string, QueueProofMatch[]>> {
  const placeIds = [...new Set(docs.map((doc) => doc.get("placeId") as string))];
  const byPlace = new Map(
    await Promise.all(
      placeIds.map(async (placeId) => [placeId, await placeFingerprints(firestore, placeId).get()] as const),
    ),
  );
  const matchedIds = new Map(
    docs.map((doc) => {
      const place = byPlace.get(doc.get("placeId") as string);
      const own = place?.docs.find((fingerprint) => fingerprint.id === doc.id);
      const ids = own && place ? matchingTestimonyIds(own.data() as ProofFingerprintDoc, place, doc.id) : [];
      return [doc.id, ids] as const;
    }),
  );

  const ids = [...new Set([...matchedIds.values()].flat())];
  const matched = ids.length > 0 ? await firestore.getAll(...ids.map((id) => testimonies(firestore).doc(id))) : [];
  const links = new Map<string, QueueProofMatch>();
  for (const snapshot of matched) {
    const testimony = snapshot.data() as TestimonyDoc | undefined;
    if (!testimony || testimony.status === "deleted") continue;
    links.set(snapshot.id, {
      testimonyId: snapshot.id,
      placeId: testimony.placeId,
      displayName: testimony.displayName,
      status: testimony.status,
    });
  }
  return new Map([...matchedIds].map(([id, list]) => [id, list.flatMap((match) => links.get(match) ?? [])]));
}

/**
 * Accepts or rejects a waiting proof, logged in the same transaction. Accept makes the
 * Testimony Proven: when it is published, the Provider's aggregates are recomputed and
 * the impact counter moves now; otherwise both follow when it is published. Reject
 * keeps the admin's note for the author. Either way the proof's own file is deleted
 * afterwards, never a newer proof's.
 */
export async function proofAction(context: AppLoadContext, acting: Acting, action: ProofAction): Promise<void> {
  const { firestore } = acting;
  const ref = testimonies(firestore).doc(acting.request.subjectId);
  const decidedFile = await firestore.runTransaction(async (tx) => {
    const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
    if (!testimony || testimony.status === "deleted") throw new AdminRefusal(404, "not_found");
    const proof = testimony.proofOfVisit;
    if (proof?.result !== "pending") throw new AdminRefusal(404, "not_found");
    // The author replaced the proof since the admin was shown it: decide nothing unseen.
    if (Date.parse(acting.request.proofCheckedAt ?? "") !== proof.checkedAt.toMillis()) {
      throw new AdminRefusal(409, "proof_changed");
    }

    if (action === "acceptProof") {
      if (testimony.status === "published") {
        const provider = await tx.get(firestore.collection(COLLECTIONS.providers).doc(testimony.placeId));
        const published = await tx.get(publishedOf(firestore, testimony.placeId));
        writeProviderOnPublish(tx, {
          placeId: testimony.placeId,
          provider,
          published,
          testimonyId: ref.id,
          self: { ...testimony, verifiedVisit: true },
          proposal: null,
        });
      }
      // `updatedAt` stays: a held or hidden Testimony's queue target counts from it.
      tx.update(ref, { proofOfVisit: decidedRecord(proof, { result: "accepted" }), verifiedVisit: true });
      recordTestimonyTransition(
        firestore,
        tx,
        { status: testimony.status, verifiedVisit: testimony.verifiedVisit },
        { status: testimony.status, verifiedVisit: true },
      );
    } else {
      const note = acting.request.reason;
      rejectWaitingProof(tx, firestore, ref, proof, {
        reason: "adminRejected",
        ...(note ? { adminReason: note } : {}),
      });
    }
    logAction(tx, acting, {
      subjectType: "proofOfVisit",
      subjectId: ref.id,
      placeId: testimony.placeId,
      fromStatus: "pending",
      toStatus: action === "acceptProof" ? "accepted" : "rejected",
    });
    return proof.filePath;
  });

  if (!context.uploads || !decidedFile) return;
  try {
    await deleteProofFile(context.uploads, decidedFile);
  } catch (error) {
    // The bucket's 7-day lifecycle rule is the backstop; the decision itself stands.
    context.logger.warn("admin_action", {
      outcome: "proof_delete_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
