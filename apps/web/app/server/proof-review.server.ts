// Admin proof review (spec 09, ticket #129): a Proof of Visit the decision sent to the
// team waits in the admin queue with its private file, the facts the agent read and the
// reasons. An admin accepts it (the Testimony becomes Proven) or rejects it with a note
// the author reads; either way the file goes. Nobody deciding within 7 days is the
// proof expiry job's business (server/proof-expiry.ts): never an accept.
import {
  COLLECTIONS,
  type ProofOfVisitRecord,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import type { ProofAction, QueueItem } from "~/lib/admin-queue";
import type { Bucket } from "../../server/firebase.ts";
import { deleteStoredProofs, storedProofPaths } from "../../server/proof-files.ts";
import { type Acting, AdminRefusal, logAction, queueItem } from "./admin-common.server.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import { publishedOf, writeProviderOnPublish } from "./testimonies.server.ts";

const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const testimonies = (firestore: Firestore) => firestore.collection(COLLECTIONS.testimonies);

/** The admin-only route that streams a waiting proof file. */
export const proofFileUrl = (testimonyId: string) => `/admin/proofs/${testimonyId}`;

/**
 * The stored proof file of a Testimony, or null once it is gone. A new proof decision
 * deletes the files of the one it replaced, so there is at most one.
 */
async function proofFile(uploads: Bucket | null, testimonyId: string): Promise<string | null> {
  if (!uploads) return null;
  const [path] = await storedProofPaths(uploads, testimonyId);
  return path ?? null;
}

/**
 * GET /admin/proofs/:testimonyId: streams a waiting proof file to an allowlisted admin
 * (the Express gate refuses everyone else first). 404 once the file is gone: decided,
 * expired, or deleted by the bucket's 7-day lifecycle rule.
 */
export async function proofFileResponse(context: AppLoadContext, testimonyId: string | undefined): Promise<Response> {
  if (!context.admin) return new Response(null, { status: 403 });
  if (!testimonyId || !TESTIMONY_ID.test(testimonyId)) return new Response(null, { status: 404 });
  const path = await proofFile(context.uploads, testimonyId);
  if (!path || !context.uploads) return new Response(null, { status: 404 });
  let bytes: Buffer;
  try {
    [bytes] = await context.uploads.file(path).download();
  } catch {
    // Deleted between the listing and the download.
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": path.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
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
  // The author's delete takes the file with it; the tombstone has nothing to review.
  const docs = pending.docs.filter((doc) => doc.get("status") !== "deleted");
  if (docs.length === 0) return [];

  const placeIds = [...new Set(docs.map((doc) => doc.get("placeId") as string))];
  const providers = await firestore.getAll(
    ...placeIds.map((id) => firestore.collection(COLLECTIONS.providers).doc(id)),
  );
  const names = new Map(providers.filter((s) => s.exists).map((s) => [s.id, (s.data() as ProviderDoc).name] as const));

  return Promise.all(
    docs.map(async (doc) => {
      const t = doc.data() as TestimonyDoc;
      const proof = t.proofOfVisit as ProofOfVisitRecord;
      const listedName = names.get(t.placeId);
      const path = await proofFile(context.uploads, doc.id);
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
            visitMonth: t.visitMonth,
            displayName: t.displayName,
            fileUrl: path ? proofFileUrl(doc.id) : null,
            ...(path ? { fileType: path.endsWith(".pdf") ? ("pdf" as const) : ("image" as const) } : {}),
            ...(proof.clinicNameOnProof ? { clinicNameOnProof: proof.clinicNameOnProof } : {}),
            ...(proof.proofDate ? { proofDate: proof.proofDate } : {}),
            ...(proof.totalRupiah !== undefined ? { totalRupiah: proof.totalRupiah } : {}),
            reasons: proof.reasons ?? [],
            attempts: proof.attempts ?? 1,
            matchingTestimonies: [],
          },
        },
        proof.checkedAt,
        nowMs,
      );
    }),
  );
}

/**
 * Accepts or rejects a waiting proof, logged in the same transaction. Accept makes the
 * Testimony Proven: when it is published, the Provider's aggregates are recomputed and
 * the impact counter moves now; otherwise both follow when it is published. Reject
 * keeps the admin's note for the author. Either way the file is deleted afterwards.
 */
export async function proofAction(context: AppLoadContext, acting: Acting, action: ProofAction): Promise<void> {
  const { firestore } = acting;
  const ref = testimonies(firestore).doc(acting.request.subjectId);
  await firestore.runTransaction(async (tx) => {
    const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
    if (!testimony || testimony.status === "deleted") throw new AdminRefusal(404, "not_found");
    const proof = testimony.proofOfVisit;
    if (proof?.result !== "pending") throw new AdminRefusal(404, "not_found");
    const { reasons: _waitedFor, ...facts } = proof;

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
      const accepted: ProofOfVisitRecord = { ...facts, result: "accepted" };
      // `updatedAt` stays: a held or hidden Testimony's queue target counts from it.
      tx.update(ref, { proofOfVisit: accepted, verifiedVisit: true });
      recordTestimonyTransition(
        firestore,
        tx,
        { status: testimony.status, verifiedVisit: testimony.verifiedVisit },
        { status: testimony.status, verifiedVisit: true },
      );
    } else {
      const rejected: ProofOfVisitRecord = {
        ...facts,
        result: "rejected",
        reason: "adminRejected",
        ...(acting.request.reason ? { adminReason: acting.request.reason } : {}),
      };
      tx.update(ref, { proofOfVisit: rejected });
    }
    logAction(tx, acting, {
      subjectType: "proofOfVisit",
      subjectId: ref.id,
      placeId: testimony.placeId,
      fromStatus: "pending",
      toStatus: action === "acceptProof" ? "accepted" : "rejected",
    });
  });

  if (!context.uploads) return;
  try {
    await deleteStoredProofs(context.uploads, ref.id);
  } catch (error) {
    // The bucket's 7-day lifecycle rule is the backstop; the decision itself stands.
    context.logger.warn("admin_action", {
      outcome: "proof_delete_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
