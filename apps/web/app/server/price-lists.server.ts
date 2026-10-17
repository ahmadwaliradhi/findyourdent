// Price Lists (spec 05, T18): upload, extraction by the agent, and confirmation.
//
// Rules decided here:
// - Only the approved claimant of a place uploads or confirms (approvedClaimOf).
// - The originals go to the private uploads bucket (`priceLists/{priceListId}/original-*`,
//   photos stripped of every metadata block) and are deleted 30 days after the upload by
//   the bucket's lifecycle rule (infra/gcp/setup.sh), confirmed or not.
// - An upload stores a `draft` with no rows: the rows Gemini read go back to the owner
//   only. Confirming stores exactly the rows the owner sent, checked here, and replaces
//   the place's current list in the same transaction.
// - A failed or invalid read keeps nothing and returns a retry message.
import {
  type ExtractedPriceRow,
  isProcedureCode,
  type PriceListExtractionRequest,
  validatePriceListExtractionResponse,
} from "@findyourdent/contracts";
import {
  COLLECTIONS,
  type PriceListDoc,
  type PriceListRow,
  type ProcedureCode,
  type ProviderDoc,
} from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n, type Language } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import {
  isPossiblyOutdated,
  ORIGINAL_RETENTION_DAYS,
  PRICE_LIST_FIELDS,
  PRICE_LIST_IMAGE_TYPES,
  PRICE_LIST_LIMITS,
  PRICE_LIST_PDF_TYPE,
  PRICE_UNITS,
  type PriceListApiError,
  type PriceListConfirmResponse,
  type PriceListUploadResponse,
  type PublicPriceList,
} from "~/lib/price-lists";
import { readSession, type SignedInUser } from "../../server/auth.ts";
import type { Bucket } from "../../server/firebase.ts";
import { jakartaDate } from "../../server/quota.ts";
import { approvedClaimOf } from "./claims.server.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { isPlaceId } from "./provider.server.ts";
import { decodes, deleteTestimonyMedia, sniffType, storePrivateDocument } from "./testimony-media.server.ts";

const PRICE_LIST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

type ErrorCode = Exclude<PriceListApiError["error"], "app_check_required" | "rate_limited">;

class PriceListRefusal extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function errorResponse(request: Request, status: number, error: ErrorCode): Promise<Response> {
  const language = await detectLanguage(request);
  const message = getI18n(language).getFixedT(language)(`priceListApi.errors.${error}`);
  const body: PriceListApiError = { error, message };
  return Response.json(body, { status });
}

const priceLists = (firestore: Firestore) => firestore.collection(COLLECTIONS.priceLists);

/** Signed in first, then App Check and the per-account owner-write limit (the upload calls Gemini). */
async function gate(
  context: AppLoadContext,
  request: Request,
): Promise<{ firestore: Firestore; uploads: Bucket; user: SignedInUser; language: Language } | Response> {
  const user = await readSession(context.auth, request.headers.get("cookie"));
  if (!user) return errorResponse(request, 401, "sign_in_required");
  const protection = await protectPaidRequest(context, { request, route: "owner", uid: user.uid });
  if (!protection.ok) return protectionRefusalResponse(request, protection);
  const { firestore, uploads } = context;
  if (!firestore || !uploads) return errorResponse(request, 503, "unavailable");
  return { firestore, uploads, user, language: await detectLanguage(request) };
}

// Upload ---------------------------------------------------------------------------

/** One PDF, or one to five photos that decode, each at most 10 MB, by their real type. */
async function readDocuments(formData: FormData): Promise<File[] | null> {
  const values = formData.getAll(PRICE_LIST_FIELDS.files);
  if (values.length === 0 || values.some((value) => typeof value === "string")) return null;
  const files = values as File[];
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > PRICE_LIST_LIMITS.totalMaxBytes) return null;
  const checked: File[] = [];
  for (const file of files) {
    if (file.size === 0 || file.size > PRICE_LIST_LIMITS.fileMaxBytes) return null;
    const type = await sniffType(file);
    if (!type) return null;
    if (type !== PRICE_LIST_PDF_TYPE && !(await decodes(file))) return null;
    checked.push(new File([file], file.name, { type }));
  }
  const pdfs = checked.filter((file) => file.type === PRICE_LIST_PDF_TYPE).length;
  if (pdfs > 0) return pdfs === 1 && checked.length === 1 ? checked : null;
  const images = checked.every((file) => (PRICE_LIST_IMAGE_TYPES as readonly string[]).includes(file.type));
  return images && checked.length <= PRICE_LIST_LIMITS.imagesMax ? checked : null;
}

/** The stored originals as the agent reads them: photos already re-encoded without metadata. */
async function extractionRequest(uploads: Bucket, paths: string[]): Promise<PriceListExtractionRequest> {
  const encoded = await Promise.all(
    paths.map(async (path) => Buffer.from((await uploads.file(path).download())[0]).toString("base64")),
  );
  const [first] = encoded;
  if (first !== undefined && paths[0]?.endsWith(".pdf"))
    return { pdf: { mimeType: "application/pdf", dataBase64: first } };
  return { images: encoded.map((dataBase64) => ({ mimeType: "image/jpeg" as const, dataBase64 })) };
}

/** The agent's rows, or null for a failed or invalid read. Never throws. */
async function extractRows(
  context: AppLoadContext,
  request: PriceListExtractionRequest,
): Promise<ExtractedPriceRow[] | null> {
  let body: unknown;
  try {
    body = await context.adapters.agent.requestPriceListExtraction(request, { requestId: context.requestId });
  } catch (error) {
    context.logger.warn("price_list", { outcome: "agent_unavailable", error: (error as Error).name });
    return null;
  }
  if (!validatePriceListExtractionResponse(body)) {
    context.logger.warn("price_list", { outcome: "agent_invalid_response" });
    return null;
  }
  if (body.kind !== "ok" || body.rows.length === 0) return null;
  // The contract allows any row the schema accepts; the same checks as a confirmation apply.
  return body.rows.every((row) => checkRow(row) !== null) ? body.rows : null;
}

function failedBody(language: Language): PriceListUploadResponse {
  return { kind: "failed", message: getI18n(language).getFixedT(language)("priceListApi.retry") };
}

/** POST /api/providers/:placeId/price-lists: the rows Gemini read, for the owner to review. */
export async function uploadPriceListResponse(
  context: AppLoadContext,
  request: Request,
  placeId: string | undefined,
): Promise<Response> {
  if (!isPlaceId(placeId)) return errorResponse(request, 404, "not_found");
  const gated = await gate(context, request);
  if (gated instanceof Response) return gated;
  const { firestore, uploads, user, language } = gated;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(request, 400, "invalid_file");
  }
  const documents = await readDocuments(formData);
  if (!documents) return errorResponse(request, 400, "invalid_file");
  const owned = await approvedClaimOf(firestore, placeId, user.uid);
  if (!owned) return errorResponse(request, 403, "not_owner");

  const ref = priceLists(firestore).doc();
  const paths: string[] = [];
  try {
    for (const [index, document] of documents.entries()) {
      paths.push(await storePrivateDocument(uploads, `priceLists/${ref.id}/original-${index + 1}`, document));
    }
    const rows = await extractRows(context, await extractionRequest(uploads, paths));
    if (!rows) {
      await deleteTestimonyMedia(uploads, paths);
      context.logger.info("price_list", { outcome: "extraction_failed" });
      return Response.json(failedBody(language));
    }
    const uploadedAt = Timestamp.now();
    const draft: PriceListDoc = {
      placeId,
      claimId: owned.claimId,
      uploadedBy: user.uid,
      source: "ownerPriceList",
      status: "draft",
      rows: [],
      uploadedAt,
      originalDocumentPaths: paths,
      originalDeleteAfter: Timestamp.fromMillis(uploadedAt.toMillis() + ORIGINAL_RETENTION_DAYS * DAY_MS),
    };
    await ref.create(draft);
    // Row counts only: prices and procedures are the owner's to publish, not the log's.
    context.logger.info("price_list", { outcome: "extracted", rows: rows.length });
    const body: PriceListUploadResponse = { kind: "ok", priceListId: ref.id, rows };
    return Response.json(body);
  } catch (error) {
    await deleteTestimonyMedia(uploads, paths).catch(() => {});
    throw error;
  }
}

// Confirmation ---------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRupiah = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= PRICE_LIST_LIMITS.rupiahMax;

/** One row as stored, or null. Extra fields (the model's confidence) are dropped. */
function checkRow(input: unknown): PriceListRow | null {
  if (!isRecord(input)) return null;
  const procedureText = typeof input.procedureText === "string" ? input.procedureText.trim() : "";
  if (!procedureText || procedureText.length > PRICE_LIST_LIMITS.procedureTextMax) return null;
  const { minRupiah, maxRupiah, unit, procedureCode, notes } = input;
  if (!isRupiah(minRupiah) || !isRupiah(maxRupiah) || minRupiah > maxRupiah) return null;
  if (!PRICE_UNITS.includes(unit as PriceListRow["unit"])) return null;
  if (procedureCode !== undefined && (typeof procedureCode !== "string" || !isProcedureCode(procedureCode))) {
    return null;
  }
  if (notes !== undefined && typeof notes !== "string") return null;
  const note = typeof notes === "string" ? notes.trim() : "";
  if (note.length > PRICE_LIST_LIMITS.notesMax) return null;
  return {
    ...(procedureCode ? { procedureCode: procedureCode as ProcedureCode } : {}),
    procedureText,
    minRupiah,
    maxRupiah,
    unit: unit as PriceListRow["unit"],
    ...(note ? { notes: note } : {}),
  };
}

function checkRows(input: unknown): PriceListRow[] | null {
  if (!isRecord(input) || !Array.isArray(input.rows)) return null;
  if (input.rows.length === 0 || input.rows.length > PRICE_LIST_LIMITS.rowsMax) return null;
  const rows = input.rows.map(checkRow);
  return rows.every((row): row is PriceListRow => row !== null) ? rows : null;
}

/** POST /api/providers/:placeId/price-lists/:priceListId: the rows the owner confirmed become the current list. */
export async function confirmPriceListResponse(
  context: AppLoadContext,
  request: Request,
  placeId: string | undefined,
  priceListId: string | undefined,
): Promise<Response> {
  if (!isPlaceId(placeId) || !priceListId || !PRICE_LIST_ID.test(priceListId)) {
    return errorResponse(request, 404, "not_found");
  }
  const gated = await gate(context, request);
  if (gated instanceof Response) return gated;
  const { firestore, user, language } = gated;

  let rows: PriceListRow[] | null;
  try {
    rows = checkRows(await request.json());
  } catch {
    rows = null;
  }
  if (!rows) return errorResponse(request, 400, "invalid_rows");
  const confirmed = rows;

  const ref = priceLists(firestore).doc(priceListId);
  const confirmedAt = Timestamp.now();
  try {
    await firestore.runTransaction(async (tx) => {
      const owned = await approvedClaimOf(firestore, placeId, user.uid, tx);
      if (!owned) throw new PriceListRefusal(403, "not_owner");
      const draft = (await tx.get(ref)).data() as PriceListDoc | undefined;
      if (draft?.status !== "draft" || draft.placeId !== placeId || draft.claimId !== owned.claimId) {
        throw new PriceListRefusal(404, "not_found");
      }
      const current = await tx.get(
        priceLists(firestore).where("placeId", "==", placeId).where("status", "==", "current"),
      );
      for (const doc of current.docs) tx.update(doc.ref, { status: "replaced" });
      tx.update(ref, { status: "current", rows: confirmed, confirmedAt });
    });
  } catch (error) {
    if (!(error instanceof PriceListRefusal)) throw error;
    return errorResponse(request, error.status, error.code);
  }

  context.logger.info("price_list", { outcome: "confirmed", rows: confirmed.length });
  const body: PriceListConfirmResponse = {
    status: "current",
    confirmedAt: jakartaDate(confirmedAt.toMillis()),
    message: getI18n(language).getFixedT(language)("priceListApi.confirmed"),
  };
  return Response.json(body);
}

// Reading --------------------------------------------------------------------------

/** A confirmed list: what Patients see. */
export type ConfirmedPriceList = PriceListDoc & { status: "current"; confirmedAt: Timestamp };

/**
 * The current list of each claimed Provider, keyed by placeId: only a list uploaded
 * under the place's current Claim, so a revoked or replaced claimant's prices stop showing.
 */
export async function currentPriceLists(
  firestore: Firestore,
  providers: readonly ProviderDoc[],
): Promise<Map<string, ConfirmedPriceList>> {
  const claimIds = new Map(
    providers.filter((p) => p.claimStatus === "claimed" && p.claimId).map((p) => [p.placeId, p.claimId]),
  );
  const lists = new Map<string, ConfirmedPriceList>();
  const placeIds = [...claimIds.keys()];
  // `in` takes at most 30 values.
  for (let i = 0; i < placeIds.length; i += 30) {
    const snapshot = await priceLists(firestore)
      .where("placeId", "in", placeIds.slice(i, i + 30))
      .where("status", "==", "current")
      .get();
    for (const doc of snapshot.docs) {
      const list = doc.data() as PriceListDoc;
      if (list.confirmedAt && list.claimId === claimIds.get(list.placeId)) {
        lists.set(list.placeId, list as ConfirmedPriceList);
      }
    }
  }
  return lists;
}

export function publicPriceList(list: ConfirmedPriceList, now: Date = new Date()): PublicPriceList {
  return {
    rows: list.rows,
    confirmedAt: jakartaDate(list.confirmedAt.toMillis()),
    possiblyOutdated: isPossiblyOutdated(list.confirmedAt.toDate(), now),
  };
}
