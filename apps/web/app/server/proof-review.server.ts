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
import { fingerprintOf, type ProofFingerprint } from "./proof-fingerprint.ts";
import { deleteFingerprint, fingerprintRef, setFingerprint } from "./proof-fingerprints.server.ts";
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
 * The fingerprint of a pending proof that has none: it was sent to the admin before
 * fingerprints were kept. Computed from the held file while it still exists, so the
 * receipt cannot be used again once it is accepted. Undefined when there is nothing to add.
 */
async function missingFingerprint(
  context: AppLoadContext,
  firestore: Firestore,
  testimonyId: string,
): Promise<{ filePath: string; fingerprint: ProofFingerprint } | undefined> {
  const { uploads } = context;
  if (!uploads || (await fingerprintRef(firestore, testimonyId).get()).exists) return undefined;
  const proof = ((await testimonies(firestore).doc(testimonyId).get()).data() as TestimonyDoc | undefined)
    ?.proofOfVisit;
  if (proof?.result !== "pending") return undefined;
  const file = uploads.file(proof.filePath);
  if (!(await file.exists())[0]) return undefined;
  const [bytes] = await file.download();
  const mimeType = proof.filePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
  return { filePath: proof.filePath, fingerprint: await fingerprintOf({ bytes, mimeType }, proof.extracted) };
}

/**
 * Applies an admin decision on a pending proof, then deletes its file. Accept moves the
 * Testimony into the Proven Testimonies (aggregates and the Kunjungan terbukti counter
 * follow when it is published); reject keeps it Belum terbukti with the admin's reason.
 */
export async function proofAction(context: AppLoadContext, acting: Acting, action: ProofAction): Promise<void> {
  const { firestore } = acting;
  const ref = testimonies(firestore).doc(acting.request.subjectId);
  const accepting = action === "acceptProof";
  const missing = accepting ? await missingFingerprint(context, firestore, ref.id) : undefined;
  let filePath = "";
  await firestore.runTransaction(async (tx) => {
    const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
    const proof = testimony?.proofOfVisit;
    if (!testimony || testimony.status === "deleted" || proof?.result !== "pending") {
      throw new AdminRefusal(404, "not_found");
    }
    const hasFingerprint = missing ? (await tx.get(fingerprintRef(firestore, ref.id))).exists : true;
    filePath = proof.filePath;
    const now = Timestamp.now();

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
    // An accepted proof keeps its fingerprint so the receipt cannot be used again; a rejected one never counted.
    if (!accepting) deleteFingerprint(tx, firestore, ref.id);
    else if (missing && !hasFingerprint && missing.filePath === proof.filePath) {
      setFingerprint(tx, firestore, {
        testimonyId: ref.id,
        placeId: testimony.placeId,
        fingerprint: missing.fingerprint,
      });
    }
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
