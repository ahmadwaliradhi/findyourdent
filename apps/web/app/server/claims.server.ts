// Claims, owner facts and replies (spec 05, T17), on the claimant's side. The admin
// side (queue items and decisions) is owner-admin.server.ts.
//
// Rules decided here:
// - One active Claim (submitted or approved) per place, checked in the transaction
//   that creates it. A place that is not Listed needs a name and Region from the
//   claimant; it becomes a Listed Provider only when the Claim is approved.
// - The permit goes to the private uploads bucket (`claims/{claimId}/permit-*`), images
//   stripped of every metadata block; only admins can read it, through /admin.
// - Only the approved claimant of a place may write its owner facts and replies:
//   `providers/{placeId}.claimId` names the Claim, and the Claim names the claimant.
// - Nothing here can delete, hide or change a Testimony. A reply is a separate field.
import { isProcedureCode, type ModerationRequest } from "@findyourdent/contracts";
import {
  type ClaimDoc,
  COLLECTIONS,
  type ProcedureCode,
  type ProviderDoc,
  type ProviderOwnerFacts,
  type ProviderType,
  type RegionRef,
  type TestimonyDoc,
  type TestimonyReply,
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
import { getI18n, type Language } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import {
  CLAIM_CHECK_WORKING_DAYS,
  CLAIM_FIELDS,
  CLAIM_ROLES,
  type ClaimApiError,
  type ClaimSubmitResponse,
  type MyClaim,
  OWNER_LIMITS,
  type OwnerContentResponse,
  PERMIT_MAX_BYTES,
  PERMIT_MIME_TYPES,
  PROVIDER_TYPES,
} from "~/lib/claims";
import { normalizeName } from "~/lib/normalize-name";
import { isValidRegion } from "~/lib/regions";
import { readSession, type SignedInUser } from "../../server/auth.ts";
import type { Bucket } from "../../server/firebase.ts";
import { flattenOwnerFacts, moderateOwnerContent, ownerDecisionDoc } from "./owner-moderation.server.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { isPlaceId } from "./provider.server.ts";
import { regionValue } from "./testimonies.server.ts";
import { decodes, deleteTestimonyMedia, sniffType, storePrivateDocument } from "./testimony-media.server.ts";

const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Spaces, dashes, dots, brackets and a leading plus around 7 to 15 digits. */
const PHONE_CHARS = /^\+?[\d\s().-]+$/;
const isPhone = (value: string) => PHONE_CHARS.test(value) && /^(\D*\d){7,15}\D*$/.test(value);

export type OwnerFactsValues = Pick<
  ProviderOwnerFacts,
  "name" | "providerType" | "region" | "address" | "phone" | "whatsapp" | "openingHours"
> & { services: ProcedureCode[] };

type ErrorCode = Exclude<ClaimApiError["error"], "app_check_required" | "rate_limited">;

class ClaimRefusal extends Error {
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
  const message = getI18n(language).getFixedT(language)(`claimApi.errors.${error}`);
  const body: ClaimApiError = { error, message };
  return Response.json(body, { status });
}

async function refusalResponse(request: Request, error: unknown): Promise<Response> {
  if (!(error instanceof ClaimRefusal)) throw error;
  return errorResponse(request, error.status, error.code);
}

const claims = (firestore: Firestore) => firestore.collection(COLLECTIONS.claims);
const providers = (firestore: Firestore) => firestore.collection(COLLECTIONS.providers);
const testimonies = (firestore: Firestore) => firestore.collection(COLLECTIONS.testimonies);

export const activeClaimsOf = (firestore: Firestore, placeId: string) =>
  claims(firestore).where("placeId", "==", placeId).where("status", "in", ["submitted", "approved"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function parseRegion(value: unknown): RegionRef | null {
  if (!isRecord(value)) return null;
  const provinceCode = trimmed(value.provinceCode);
  const regencyCode = trimmed(value.regencyCode);
  const districtCode = trimmed(value.districtCode) || undefined;
  const region = { provinceCode, regencyCode, ...(districtCode ? { districtCode } : {}) };
  return isValidRegion(region) ? region : null;
}

/** Signed in first (so the claimant learns to sign in), then App Check and the per-account limit. */
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

/**
 * The approved Claim through which `uid` owns `placeId`, read in the transaction
 * when one is given; null when the place is not claimed by them.
 */
export async function approvedClaimOf(
  firestore: Firestore,
  placeId: string,
  uid: string,
  tx?: Transaction,
): Promise<{ claimId: string; provider: DocumentSnapshot } | null> {
  const read = (ref: DocumentReference) => (tx ? tx.get(ref) : ref.get());
  const provider = await read(providers(firestore).doc(placeId));
  const claimId = provider.get("claimId") as string | undefined;
  if (!provider.exists || provider.get("claimStatus") !== "claimed" || !claimId) return null;
  const claim = (await read(claims(firestore).doc(claimId))).data() as ClaimDoc | undefined;
  return claim?.status === "approved" && claim.claimantUid === uid ? { claimId, provider } : null;
}

// Submitting a Claim ---------------------------------------------------------------

interface CheckedClaim {
  role: ClaimDoc["role"];
  contactPhone: string;
  providerName?: string;
  region?: RegionRef;
}

function checkClaim(raw: FormDataEntryValue | null, listed: boolean): CheckedClaim | null {
  let input: unknown;
  try {
    input = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!isRecord(input)) return null;
  const role = input.role as ClaimDoc["role"];
  const contactPhone = trimmed(input.contactPhone);
  if (!CLAIM_ROLES.includes(role) || !isPhone(contactPhone)) return null;
  if (listed) return { role, contactPhone };
  const providerName = trimmed(input.providerName);
  const region = parseRegion(input.region);
  if (!providerName || providerName.length > OWNER_LIMITS.nameMax || !region) return null;
  return { role, contactPhone, providerName, region };
}

/** The one permit file: an image that decodes, or a PDF, at most 10 MB, by its real type. */
async function readPermit(formData: FormData): Promise<File | null> {
  const values = formData.getAll(CLAIM_FIELDS.permit);
  if (values.length !== 1 || typeof values[0] === "string") return null;
  const file = values[0] as File;
  if (file.size === 0 || file.size > PERMIT_MAX_BYTES) return null;
  const type = await sniffType(file);
  if (!type || !(PERMIT_MIME_TYPES as readonly string[]).includes(type)) return null;
  if (type !== "application/pdf" && !(await decodes(file))) return null;
  return new File([file], file.name, { type });
}

/** POST /api/providers/:placeId/claims: a new submitted Claim with its permit. */
export async function submitClaimResponse(context: AppLoadContext, request: Request, placeId: string | undefined) {
  if (!isPlaceId(placeId)) return errorResponse(request, 404, "not_found");
  const gated = await gate(context, request);
  if (gated instanceof Response) return gated;
  const { firestore, uploads, user, language } = gated;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(request, 400, "invalid_claim");
  }
  const listed = (await providers(firestore).doc(placeId).get()).exists;
  const checked = checkClaim(formData.get(CLAIM_FIELDS.json), listed);
  if (!checked) return errorResponse(request, 400, "invalid_claim");
  const permit = await readPermit(formData);
  if (!permit) return errorResponse(request, 400, "invalid_file");

  // Fast refusal before the upload; the transaction below is the real guarantee.
  if (!(await activeClaimsOf(firestore, placeId).limit(1).get()).empty) {
    return errorResponse(request, 409, "claim_exists");
  }

  const ref = claims(firestore).doc();
  const permitPath = await storePrivateDocument(uploads, `claims/${ref.id}/permit-${Date.now()}`, permit);
  try {
    await firestore.runTransaction(async (tx) => {
      if (!(await tx.get(activeClaimsOf(firestore, placeId))).empty) throw new ClaimRefusal(409, "claim_exists");
      const now = Timestamp.now();
      const doc: ClaimDoc = {
        placeId,
        claimantUid: user.uid,
        role: checked.role,
        contactPhone: checked.contactPhone,
        ...(checked.providerName ? { proposedProviderName: checked.providerName } : {}),
        ...(checked.region ? { proposedRegion: checked.region } : {}),
        permitDocumentPath: permitPath,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      };
      tx.create(ref, doc);
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, [permitPath]).catch(() => {});
    return refusalResponse(request, error);
  }

  context.logger.info("claim", { outcome: "submitted", listed });
  const t = getI18n(language).getFixedT(language);
  const body: ClaimSubmitResponse = {
    claimId: ref.id,
    status: "submitted",
    message: t("claimApi.submitted", { days: CLAIM_CHECK_WORKING_DAYS }),
  };
  return Response.json(body, { status: 201 });
}

// Owner facts ----------------------------------------------------------------------

function checkOwnerFacts(input: unknown): OwnerFactsValues | null {
  if (!isRecord(input)) return null;
  const name = trimmed(input.name);
  const providerType = input.providerType as ProviderType;
  const region = parseRegion(input.region);
  if (!name || name.length > OWNER_LIMITS.nameMax || !PROVIDER_TYPES.includes(providerType) || !region) return null;

  const optional = (key: string, max: number, valid?: (text: string) => boolean): string | undefined | null => {
    const value = input[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return undefined;
    return text.length <= max && (!valid || valid(text)) ? text : null;
  };
  const address = optional("address", OWNER_LIMITS.addressMax);
  const phone = optional("phone", OWNER_LIMITS.phoneMax, isPhone);
  const whatsapp = optional("whatsapp", OWNER_LIMITS.phoneMax, isPhone);
  const openingHours = optional("openingHours", OWNER_LIMITS.openingHoursMax);
  if ([address, phone, whatsapp, openingHours].includes(null)) return null;

  const services = input.services ?? [];
  if (!Array.isArray(services) || services.length > OWNER_LIMITS.servicesMax) return null;
  if (!services.every((code): code is ProcedureCode => typeof code === "string" && isProcedureCode(code))) return null;

  return {
    name,
    providerType,
    region,
    ...(address ? { address } : {}),
    ...(phone ? { phone } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(openingHours ? { openingHours } : {}),
    services: [...new Set(services)],
  };
}

/**
 * Publishes owner facts, after every transaction read: they replace the typed name
 * and the inferred type on the Listed Provider, and the Region and type are copied
 * to the place's Testimonies for the feed filters (spec 04).
 */
export function applyOwnerFacts(
  tx: Transaction,
  input: {
    provider: DocumentReference;
    facts: OwnerFactsValues;
    moderationDecisionId?: string;
    placeTestimonies: QuerySnapshot;
  },
) {
  const { facts } = input;
  const now = Timestamp.now();
  const ownerFacts: ProviderOwnerFacts = {
    ...facts,
    region: regionValue(facts.region),
    moderationStatus: "published",
    ...(input.moderationDecisionId ? { moderationDecisionId: input.moderationDecisionId } : {}),
    updatedAt: now,
  };
  tx.update(input.provider, {
    name: facts.name,
    nameSource: "claim",
    nameNormalized: normalizeName(facts.name),
    providerType: facts.providerType,
    providerTypeSource: "claimed",
    region: regionValue(facts.region),
    ownerFacts,
    pendingOwnerFacts: FieldValue.delete(),
    updatedAt: now,
  });
  for (const doc of input.placeTestimonies.docs) {
    if (doc.get("status") === "deleted") continue;
    tx.update(doc.ref, { region: regionValue(facts.region), providerType: facts.providerType });
  }
}

/** POST /api/providers/:placeId/owner-facts: moderated, then published or held. */
export async function saveOwnerFactsResponse(context: AppLoadContext, request: Request, placeId: string | undefined) {
  if (!isPlaceId(placeId)) return errorResponse(request, 404, "not_found");
  const gated = await gate(context, request);
  if (gated instanceof Response) return gated;
  const { firestore, user, language } = gated;

  let facts: OwnerFactsValues | null;
  try {
    facts = checkOwnerFacts(await request.json());
  } catch {
    facts = null;
  }
  if (!facts) return errorResponse(request, 400, "invalid_facts");
  const owned = await approvedClaimOf(firestore, placeId, user.uid);
  if (!owned) return errorResponse(request, 403, "not_owner");

  const moderationRequest: ModerationRequest = {
    subjectType: "providerFacts",
    language,
    text: flattenOwnerFacts(facts, language),
    typedProviderName: facts.name,
  };
  const outcome = await moderateOwnerContent(context, moderationRequest);
  const status = outcome.decision.decision === "publish" ? "published" : "held";
  const values = facts;

  try {
    await firestore.runTransaction(async (tx) => {
      const still = await approvedClaimOf(firestore, placeId, user.uid, tx);
      if (!still) throw new ClaimRefusal(403, "not_owner");
      const placeTestimonies =
        status === "published" ? await tx.get(testimonies(firestore).where("placeId", "==", placeId)) : null;
      const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();
      tx.create(decisionRef, ownerDecisionDoc(outcome, { subjectType: "providerFacts", subjectId: placeId, placeId }));
      if (placeTestimonies) {
        applyOwnerFacts(tx, {
          provider: still.provider.ref,
          facts: values,
          moderationDecisionId: decisionRef.id,
          placeTestimonies,
        });
      } else {
        // Held facts wait apart; the published facts, name, type and Region stay live meanwhile.
        const pendingOwnerFacts: ProviderOwnerFacts = {
          ...values,
          region: regionValue(values.region),
          moderationStatus: "held",
          moderationDecisionId: decisionRef.id,
          updatedAt: Timestamp.now(),
        };
        tx.update(still.provider.ref, { pendingOwnerFacts, updatedAt: Timestamp.now() });
      }
    });
  } catch (error) {
    return refusalResponse(request, error);
  }

  return Response.json(ownerContentBody(language, "facts", status));
}

function ownerContentBody(
  language: Language,
  kind: "facts" | "reply",
  status: OwnerContentResponse["status"],
): OwnerContentResponse {
  const t = getI18n(language).getFixedT(language);
  return { status, message: t(`claimApi.${kind}.${status}`) };
}

// Replies --------------------------------------------------------------------------

/** POST /api/testimonies/:testimonyId/reply: the claimant's one public reply, moderated. */
export async function saveReplyResponse(context: AppLoadContext, request: Request, testimonyId: string | undefined) {
  if (!testimonyId || !TESTIMONY_ID.test(testimonyId)) return errorResponse(request, 404, "not_found");
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
  if (!text || text.length > OWNER_LIMITS.replyMax) return errorResponse(request, 400, "invalid_reply");

  const ref = testimonies(firestore).doc(testimonyId);
  const testimony = (await ref.get()).data() as TestimonyDoc | undefined;
  if (testimony?.status !== "published") return errorResponse(request, 404, "not_found");
  const owned = await approvedClaimOf(firestore, testimony.placeId, user.uid);
  if (!owned) return errorResponse(request, 403, "not_owner");

  const outcome = await moderateOwnerContent(context, {
    subjectType: "reply",
    language,
    text,
    typedProviderName: owned.provider.get("name") as string,
  });
  const status = outcome.decision.decision === "publish" ? "published" : "held";

  try {
    await firestore.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as TestimonyDoc | undefined;
      if (current?.status !== "published") throw new ClaimRefusal(404, "not_found");
      const still = await approvedClaimOf(firestore, current.placeId, user.uid, tx);
      if (!still) throw new ClaimRefusal(403, "not_owner");
      const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();
      tx.create(
        decisionRef,
        ownerDecisionDoc(outcome, { subjectType: "reply", subjectId: testimonyId, placeId: current.placeId }),
      );
      const now = Timestamp.now();
      const reply: TestimonyReply = {
        text,
        authorUid: user.uid,
        claimId: still.claimId,
        status,
        moderationDecisionId: decisionRef.id,
        // An edit keeps the first reply's date, as long as it is the same Claim's reply.
        createdAt: current.reply?.claimId === still.claimId ? current.reply.createdAt : now,
        updatedAt: now,
      };
      // Only the reply field: the Testimony itself is never touched.
      tx.update(ref, { reply });
    });
  } catch (error) {
    return refusalResponse(request, error);
  }

  return Response.json(ownerContentBody(language, "reply", status));
}

// The Claim page -------------------------------------------------------------------

export interface OwnerTestimony {
  id: string;
  displayName: string;
  text: string;
  visitMonth: string;
  reply?: { text: string; status: TestimonyReply["status"] };
}

export interface ClaimPageData {
  placeId: string;
  /** The Listed name; null when the place is not Listed yet. */
  providerName: string | null;
  claimed: boolean;
  signedIn: boolean;
  /** The signed-in user's latest Claim on this place. */
  myClaim: MyClaim | null;
  /** Another account's Claim is active, so this user cannot claim now. */
  claimedByOther: boolean;
  /** Present for the approved claimant: current facts (or the Listed values) and the Testimonies to reply to. */
  owner: {
    facts: OwnerFactsValues;
    factsStatus: "published" | "held" | "none";
    testimonies: OwnerTestimony[];
  } | null;
}

/** Everything the Claim page needs for the signed-in (or signed-out) visitor. */
export async function loadClaimPage(
  context: AppLoadContext,
  request: Request,
  placeId: string,
): Promise<ClaimPageData> {
  const { firestore } = context;
  const user = await readSession(context.auth, request.headers.get("cookie"));
  const providerSnapshot = firestore ? await providers(firestore).doc(placeId).get() : null;
  const provider = providerSnapshot?.exists ? (providerSnapshot.data() as ProviderDoc) : null;
  const base: ClaimPageData = {
    placeId,
    providerName: provider?.name ?? null,
    claimed: provider?.claimStatus === "claimed",
    signedIn: Boolean(user),
    myClaim: null,
    claimedByOther: false,
    owner: null,
  };
  if (!firestore || !user) return base;

  const [mine, active] = await Promise.all([
    claims(firestore).where("claimantUid", "==", user.uid).where("placeId", "==", placeId).get(),
    activeClaimsOf(firestore, placeId).get(),
  ]);
  const latest = mine.docs
    .map((doc) => ({ id: doc.id, claim: doc.data() as ClaimDoc }))
    .sort((a, b) => b.claim.createdAt.toMillis() - a.claim.createdAt.toMillis())[0];
  const myClaim: MyClaim | null = latest
    ? {
        claimId: latest.id,
        status: latest.claim.status,
        ...(latest.claim.rejectionReason ? { rejectionReason: latest.claim.rejectionReason } : {}),
        createdAt: latest.claim.createdAt.toDate().toISOString(),
      }
    : null;
  const claimedByOther = active.docs.some((doc) => doc.get("claimantUid") !== user.uid);

  const isOwner = provider && myClaim?.status === "approved" && provider.claimId === myClaim.claimId;
  if (!isOwner) return { ...base, myClaim, claimedByOther };

  const published = await testimonies(firestore)
    .where("placeId", "==", placeId)
    .where("status", "==", "published")
    .orderBy("publishedAt", "desc")
    .limit(100)
    .get();
  // The owner edits their latest version: a held edit if there is one.
  const facts = provider.pendingOwnerFacts ?? provider.ownerFacts;
  return {
    ...base,
    myClaim,
    owner: {
      facts: {
        name: facts?.name ?? provider.name,
        providerType: facts?.providerType ?? provider.providerType,
        region: facts?.region ?? provider.region,
        ...(facts?.address ? { address: facts.address } : {}),
        ...(facts?.phone ? { phone: facts.phone } : {}),
        ...(facts?.whatsapp ? { whatsapp: facts.whatsapp } : {}),
        ...(facts?.openingHours ? { openingHours: facts.openingHours } : {}),
        services: facts?.services ?? [],
      },
      factsStatus: facts?.moderationStatus ?? "none",
      testimonies: published.docs.map((doc) => {
        const t = doc.data() as TestimonyDoc;
        const reply = t.reply?.claimId === provider.claimId ? t.reply : undefined;
        return {
          id: doc.id,
          displayName: t.displayName,
          text: t.text,
          visitMonth: t.visitMonth,
          ...(reply ? { reply: { text: reply.text, status: reply.status } } : {}),
        };
      }),
    },
  };
}

// The permit, for admins -----------------------------------------------------------

/** GET /admin/claims/:claimId/permit: streams the private permit to an allowlisted admin. */
export async function permitResponse(context: AppLoadContext, claimId: string | undefined): Promise<Response> {
  if (!context.admin) return new Response(null, { status: 403 });
  const { firestore, uploads } = context;
  if (!firestore || !uploads || !claimId || !TESTIMONY_ID.test(claimId)) return new Response(null, { status: 404 });
  const path = (await claims(firestore).doc(claimId).get()).get("permitDocumentPath") as string | undefined;
  if (!path) return new Response(null, { status: 404 });
  const file = uploads.file(path);
  const [exists] = await file.exists();
  if (!exists) return new Response(null, { status: 404 });
  const [bytes] = await file.download();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": path.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Removes a Claim's permit file and field; call after the transaction that decided it. */
export async function deletePermit(uploads: Bucket | null, path: string | undefined): Promise<void> {
  if (uploads && path) await deleteTestimonyMedia(uploads, [path]);
}
