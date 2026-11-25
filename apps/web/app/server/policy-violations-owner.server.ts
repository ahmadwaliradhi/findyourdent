// Testimony Policy Violation cases on the owner pages (spec 09 part 2, issue #137): what the
// claimed Provider sees of its cases and how its approved claimant responds. The admin side
// is policy-violations.server.ts.
import { COLLECTIONS, type PolicyViolationDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n } from "~/i18n/config";
import {
  type OwnerViolation,
  VIOLATION_RESPONSE_MAX_CHARS,
  type ViolationResponseResult,
} from "~/lib/policy-violations";
import { iso, SUBJECT_ID } from "./admin-common.server.ts";
import {
  approvedClaimOf,
  ClaimRefusal,
  errorResponse,
  gate,
  isRecord,
  refusalResponse,
  trimmed,
} from "./claims.server.ts";
import { isPlaceId } from "./provider.server.ts";

/**
 * The cases the Provider may see: ones it was notified of (`notifiedAt` set), newest first.
 * A case dismissed straight from `open` was never notified and stays admin-only. Evidence
 * never leaves this function.
 */
export async function violationsOf(firestore: Firestore, placeId: string): Promise<OwnerViolation[]> {
  const snapshot = await firestore
    .collection(COLLECTIONS.policyViolations)
    .where("placeId", "==", placeId)
    .where("status", "in", ["providerNotified", "confirmed", "dismissed"])
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, violation: doc.data() as PolicyViolationDoc }))
    .filter(({ violation }) => violation.notifiedAt)
    .sort((a, b) => b.violation.createdAt.toMillis() - a.violation.createdAt.toMillis())
    .map(({ id, violation }) => ({
      id,
      status: violation.status as OwnerViolation["status"],
      suspectedPeriod: violation.suspectedPeriod,
      ...(violation.notifiedAt ? { notifiedAt: iso(violation.notifiedAt) } : {}),
      ...(violation.responseDueAt ? { responseDueAt: iso(violation.responseDueAt) } : {}),
      canRespond: violation.status === "providerNotified",
      ...(violation.providerResponse
        ? {
            providerResponse: {
              text: violation.providerResponse.text,
              respondedAt: iso(violation.providerResponse.respondedAt),
            },
          }
        : {}),
      ...(violation.decisionReason ? { decisionReason: violation.decisionReason } : {}),
    }));
}

/**
 * POST /api/providers/:placeId/policy-violations/:violationId/response: the claimant's
 * response to a notified case. Not moderated and not public: only admins read it. A later
 * response replaces the earlier one while the case is still `providerNotified`.
 */
export async function saveViolationResponse(
  context: AppLoadContext,
  request: Request,
  placeId: string | undefined,
  violationId: string | undefined,
) {
  if (!isPlaceId(placeId) || !violationId || !SUBJECT_ID.test(violationId)) {
    return errorResponse(request, 404, "not_found");
  }
  const gated = await gate(context, request);
  if (gated instanceof Response) return gated;
  const { firestore, user, language } = gated;

  let text = "";
  try {
    const body: unknown = await request.json();
    text = isRecord(body) ? trimmed(body.text) : "";
  } catch {
    text = "";
  }
  if (!text || text.length > VIOLATION_RESPONSE_MAX_CHARS) return errorResponse(request, 400, "invalid_response");

  const ref = firestore.collection(COLLECTIONS.policyViolations).doc(violationId);
  let respondedAt: Timestamp;
  try {
    respondedAt = await firestore.runTransaction(async (tx) => {
      // Not the claimant of this place: 403 before anything about its cases is revealed.
      if (!(await approvedClaimOf(firestore, placeId, user.uid, tx))) throw new ClaimRefusal(403, "not_owner");
      const violation = (await tx.get(ref)).data() as PolicyViolationDoc | undefined;
      // Another place's case looks the same as a missing one.
      if (!violation || violation.placeId !== placeId) throw new ClaimRefusal(404, "not_found");
      if (violation.status !== "providerNotified") throw new ClaimRefusal(409, "violation_closed");
      const now = Timestamp.now();
      tx.update(ref, { providerResponse: { text, respondedAt: now, responderUid: user.uid }, updatedAt: now });
      return now;
    });
  } catch (error) {
    return refusalResponse(request, error);
  }

  context.logger.info("violation_response", { outcome: "saved" });
  const t = getI18n(language).getFixedT(language);
  const body: ViolationResponseResult = {
    status: "saved",
    respondedAt: respondedAt.toDate().toISOString(),
    message: t("claimApi.violationResponse.saved"),
  };
  return Response.json(body);
}
