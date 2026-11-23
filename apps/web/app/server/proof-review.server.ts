// Admin proof review (spec 09, ADR-0011): a pending Proof of Visit waits in the admin
// queue (admin-queue.server.ts) with its private file. Accept makes the Testimony a
// Proven Testimony; reject tells the author why. Both are logged in `adminActions` in
// the transaction that applies them, and both delete the file. Nothing is ever
// accepted by timeout.
import { COLLECTIONS, type ProofOfVisitRecord, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import type { ProofAction } from "~/lib/admin-queue";
import { type Acting, AdminRefusal, logAction } from "./admin-common.server.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import { publishedOf, writeProviderOnPublish } from "./testimonies.server.ts";
import { deleteTestimonyMedia, privateFileResponse } from "./testimony-media.server.ts";

const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const testimonies = (firestore: Firestore) => firestore.collection(COLLECTIONS.testimonies);

/** The admin-only route that streams a pending proof's file. */
export const proofFileUrl = (testimonyId: string) => `/admin/proofs/${testimonyId}/file`;

/** GET /admin/proofs/:testimonyId/file: the private file of a pending proof, for allowlisted admins only. */
export async function proofFileResponse(context: AppLoadContext, testimonyId: string | undefined): Promise<Response> {
  if (!context.admin) return new Response(null, { status: 403 });
  const { firestore, uploads } = context;
  if (!firestore || !uploads || !testimonyId || !TESTIMONY_ID.test(testimonyId)) {
    return new Response(null, { status: 404 });
  }
  const testimony = (await testimonies(firestore).doc(testimonyId).get()).data() as TestimonyDoc | undefined;
  const proof = testimony?.proofOfVisit;
  if (proof?.result !== "pending") return new Response(null, { status: 404 });
  return privateFileResponse(uploads, proof.filePath);
}

/**
 * Applies an admin decision on a pending proof, then deletes its file. Accept moves the
 * Testimony into the Proven Testimonies (aggregates and the Kunjungan terbukti counter
 * follow when it is published); reject keeps it Belum terbukti with the admin's reason.
 */
export async function proofAction(context: AppLoadContext, acting: Acting, action: ProofAction): Promise<void> {
  const { firestore } = acting;
  const ref = testimonies(firestore).doc(acting.request.subjectId);
  let filePath = "";
  await firestore.runTransaction(async (tx) => {
    const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
    const proof = testimony?.proofOfVisit;
    if (!testimony || testimony.status === "deleted" || proof?.result !== "pending") {
      throw new AdminRefusal(404, "not_found");
    }
    filePath = proof.filePath;
    const now = Timestamp.now();
    const accepting = action === "acceptProof";

    if (accepting && testimony.status === "published") {
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
    const decided: ProofOfVisitRecord = accepting
      ? { checkedAt: now, result: "accepted", ...(proof.extracted ? { extracted: proof.extracted } : {}) }
      : {
          checkedAt: now,
          result: "rejected",
          reason: "adminRejected",
          ...(acting.request.reason ? { adminReason: acting.request.reason } : {}),
        };
    tx.update(ref, { proofOfVisit: decided, verifiedVisit: accepting, updatedAt: now });
    recordTestimonyTransition(
      firestore,
      tx,
      { status: testimony.status, verifiedVisit: testimony.verifiedVisit },
      { status: testimony.status, verifiedVisit: accepting },
    );
    logAction(tx, acting, {
      subjectType: "testimony",
      subjectId: ref.id,
      placeId: testimony.placeId,
      fromStatus: "proof.pending",
      toStatus: `proof.${decided.result}`,
    });
  });
  // The decision is committed; a failed delete is left to the 7-day lifecycle rule.
  if (context.uploads) await deleteTestimonyMedia(context.uploads, [filePath]).catch(() => {});
}
