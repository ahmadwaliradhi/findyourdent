// Testimony reports (spec 03, T14). Anyone can report a public Testimony; a
// personal data or threat report hides it at once (a system move in
// testimony-state.ts), before any human looks. Every report lands in the admin queue.
import { COLLECTIONS, type TestimonyDoc, type TestimonyReportDoc } from "@findyourdent/contracts/firestore";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import {
  HIDING_CATEGORIES,
  isReportCategory,
  REPORT_DETAILS_MAX_CHARS,
  type ReportApiError,
  type ReportRequest,
  type ReportResponse,
} from "~/lib/reports";
import { readSession } from "../../server/auth.ts";
import { approvedClaimOf } from "./claims.server.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { publishedOf, writeProviderOnUnpublish } from "./testimonies.server.ts";
import { canTransition } from "./testimony-state.ts";

const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function errorResponse(request: Request, status: number, error: ReportApiError["error"]): Promise<Response> {
  const language = await detectLanguage(request);
  const message = getI18n(language).getFixedT(language)(`reportApi.errors.${error}`);
  const body: ReportApiError = { error, message };
  return Response.json(body, { status });
}

function parseReport(body: unknown): ReportRequest | null {
  if (!body || typeof body !== "object") return null;
  const { category, details } = body as Record<string, unknown>;
  if (!isReportCategory(category)) return null;
  if (details === undefined || details === null) return { category };
  if (typeof details !== "string") return null;
  const trimmed = details.trim();
  if (trimmed.length > REPORT_DETAILS_MAX_CHARS) return null;
  return trimmed ? { category, details: trimmed } : { category };
}

class NotReportable extends Error {}

/** POST /api/testimonies/:testimonyId/reports. Only a public (or already hidden) Testimony can be reported. */
export async function reportTestimony(context: AppLoadContext, request: Request, testimonyId: string) {
  const protection = await protectPaidRequest(context, { request, route: "report" });
  if (!protection.ok) return protectionRefusalResponse(request, protection);
  const { firestore } = context;
  if (!firestore) return errorResponse(request, 503, "unavailable");
  if (!TESTIMONY_ID.test(testimonyId)) return errorResponse(request, 404, "not_found");

  let input: ReportRequest | null;
  try {
    input = parseReport(await request.json());
  } catch {
    input = null;
  }
  if (!input) return errorResponse(request, 400, "invalid_report");
  const report = input;

  const user = await readSession(context.auth, request.headers.get("cookie"));
  const reportRef = firestore.collection(COLLECTIONS.testimonyReports).doc();
  let hid = false;
  try {
    hid = await firestore.runTransaction((tx) => fileReport(firestore, tx, { testimonyId, report, reportRef, user }));
  } catch (error) {
    if (error instanceof NotReportable) return errorResponse(request, 404, "not_found");
    throw error;
  }

  context.logger.info("testimony_report", { outcome: "created", category: report.category, hid });
  const body: ReportResponse = { reportId: reportRef.id, hidden: hid };
  return Response.json(body, { status: 201 });
}

async function fileReport(
  firestore: Firestore,
  tx: Transaction,
  input: {
    testimonyId: string;
    report: ReportRequest;
    reportRef: DocumentReference;
    user: { uid: string } | null;
  },
): Promise<boolean> {
  const ref = firestore.collection(COLLECTIONS.testimonies).doc(input.testimonyId);
  const testimony = (await tx.get(ref)).data() as TestimonyDoc | undefined;
  if (!testimony || (testimony.status !== "published" && testimony.status !== "hidden")) throw new NotReportable();

  // The claimed Provider of the place reports like anyone, but its report never hides
  // the Testimony: no route lets a Provider hide or remove one (spec 05).
  const claimedProvider = input.user ? await approvedClaimOf(firestore, testimony.placeId, input.user.uid, tx) : null;
  const hides =
    !claimedProvider &&
    HIDING_CATEGORIES.has(input.report.category) &&
    testimony.status === "published" &&
    canTransition("published", "hidden", "system");
  if (hides) {
    const provider = await tx.get(firestore.collection(COLLECTIONS.providers).doc(testimony.placeId));
    const published = await tx.get(publishedOf(firestore, testimony.placeId));
    writeProviderOnUnpublish(tx, provider, published, input.testimonyId);
    tx.update(ref, { status: "hidden", updatedAt: Timestamp.now() });
    recordTestimonyTransition(
      firestore,
      tx,
      { status: "published", verifiedVisit: testimony.verifiedVisit },
      { status: "hidden", verifiedVisit: testimony.verifiedVisit },
    );
  }

  const doc: TestimonyReportDoc = {
    testimonyId: input.testimonyId,
    placeId: testimony.placeId,
    category: input.report.category,
    ...(input.report.details ? { details: input.report.details } : {}),
    ...(input.user ? { reporterUid: input.user.uid } : {}),
    reporterRole: claimedProvider ? "claimedProvider" : "public",
    hidTestimony: hides,
    status: "open",
    createdAt: Timestamp.now(),
  };
  tx.create(input.reportRef, doc);
  return hides;
}
