// Posting, editing and deleting a Testimony (spec 03, T11), and the author's own
// list for 'Testimoni saya'. Moderation goes through testimony-moderation.server.ts
// (a switch until T13); the state machine is testimony-state.ts.
//
// Rules decided here:
// - One Testimony per Patient per Provider among Testimonies that are not `deleted`:
//   an author delete is permanent erasure, so it frees the slot for a new one.
// - Edits count against the five-per-day submission limit (each one runs Moderation).
// - Before a place is Listed, the typed name waits on the Testimony
//   (`proposedProviderName`) and the Region in `region`; the first publish creates the
//   Listed Provider from them. Google's name is never read here, let alone stored.
// - Provider type for a new Listed Provider: the spec 02 rule (`inferProviderType`) on
//   the typed name alone, with no Google types (no extra paid call): "drg. Nama" →
//   privateDentist, anything else → klinik; `providerTypeSource` "inferred".
import {
  type AspectRatings,
  COLLECTIONS,
  type ProviderDoc,
  type ProviderType,
  type RegionRef,
  type TestimonyContent,
  type TestimonyDoc,
  type TestimonyStatus,
} from "@findyourdent/contracts/firestore";
import {
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  type QuerySnapshot,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import type { TFunction } from "i18next";
import type { AppLoadContext } from "react-router";
import { getI18n, type Language } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { normalizeName } from "~/lib/normalize-name";
import {
  SUBMISSION_FIELDS,
  TESTIMONY_TERMS_VERSION,
  type TestimonyApiError,
  type TestimonySubmission,
  type TestimonySubmitResponse,
} from "~/lib/testimony";
import { testimonyPhotoUrl } from "~/lib/testimony-photos";
import type { LatLng } from "../../server/adapters/places.ts";
import { readSession, type SignedInUser } from "../../server/auth.ts";
import type { Bucket } from "../../server/firebase.ts";
import { jakartaDate } from "../../server/quota.ts";
import { type AggregateInput, computeAggregates } from "./aggregates.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { inferProviderType } from "./shortlist.server.ts";
import {
  deleteTestimonyMedia,
  readTestimonyFiles,
  type StoredMedia,
  storeTestimonyMedia,
} from "./testimony-media.server.ts";
import {
  buildModerationRequest,
  isSpotCheck,
  type ModerationOutcome,
  moderateTestimony,
  moderationDecisionDoc,
  statusForDecision,
} from "./testimony-moderation.server.ts";
import { canAuthorEdit } from "./testimony-state.ts";
import { type CheckedSubmission, checkSubmission, PLACE_ID, parseSubmissionJson } from "./testimony-submission.ts";

const TESTIMONY_ID = /^[A-Za-z0-9_-]{1,64}$/;

type ErrorCode = Exclude<TestimonyApiError["error"], "app_check_required" | "rate_limited">;

/** A refusal decided inside a flow (often inside a transaction) and turned into a response. */
class TestimonyRefusal extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly testimonyId?: string;

  constructor(status: number, code: ErrorCode, testimonyId?: string) {
    super(code);
    this.status = status;
    this.code = code;
    if (testimonyId) this.testimonyId = testimonyId;
  }
}

async function errorResponse(
  request: Request,
  status: number,
  error: ErrorCode,
  extra: Pick<TestimonyApiError, "fieldErrors" | "testimonyId"> = {},
): Promise<Response> {
  const language = await detectLanguage(request);
  const message = getI18n(language).getFixedT(language)(`testimonyApi.errors.${error}`);
  const body: TestimonyApiError = { error, message, ...extra };
  return Response.json(body, { status });
}

const testimonies = (firestore: Firestore) => firestore.collection(COLLECTIONS.testimonies);
const providers = (firestore: Firestore) => firestore.collection(COLLECTIONS.providers);
export const publishedOf = (firestore: Firestore, placeId: string) =>
  testimonies(firestore).where("placeId", "==", placeId).where("status", "==", "published");

interface Writer {
  firestore: Firestore;
  uploads: Bucket;
  user: SignedInUser;
  language: Language;
  t: TFunction;
}

/**
 * Signed-in Google account first (so a signed-out Patient learns to sign in), then
 * App Check and the per-account daily limit for submissions and edits.
 */
async function gateSubmission(context: AppLoadContext, request: Request): Promise<Writer | Response> {
  const user = await readSession(context.auth, request.headers.get("cookie"));
  if (!user) return errorResponse(request, 401, "sign_in_required");
  const protection = await protectPaidRequest(context, { request, route: "testimony", uid: user.uid });
  if (!protection.ok) return protectionRefusalResponse(request, protection);
  return writer(context, request, user);
}

async function writer(context: AppLoadContext, request: Request, user: SignedInUser): Promise<Writer | Response> {
  const { firestore, uploads } = context;
  if (!firestore || !uploads) return errorResponse(request, 503, "unavailable");
  const language = await detectLanguage(request);
  return { firestore, uploads, user, language, t: getI18n(language).getFixedT(language) };
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

const currentMonth = () => jakartaDate(Date.now()).slice(0, 7);

/** The author-editable part, without `undefined` values (Firestore refuses them). */
function contentOf(value: CheckedSubmission, photoPaths: string[]): TestimonyContent {
  return {
    ratings: value.ratings,
    text: value.text,
    visitMonth: value.visitMonth,
    ...(value.procedureCode ? { procedureCode: value.procedureCode } : {}),
    ...(value.pricePaidRupiah !== undefined ? { pricePaidRupiah: value.pricePaidRupiah } : {}),
    photoPaths,
  };
}

/** Replaces the public content fields, clearing optional ones the edit left out. */
function contentUpdate(content: TestimonyContent): Record<string, unknown> {
  return {
    ratings: content.ratings,
    text: content.text,
    visitMonth: content.visitMonth,
    procedureCode: content.procedureCode ?? FieldValue.delete(),
    pricePaidRupiah: content.pricePaidRupiah ?? FieldValue.delete(),
    photoPaths: content.photoPaths,
  };
}

/** Moderates, then deletes the Proof of Visit file whatever happened (spec 03). */
async function moderate(
  context: AppLoadContext,
  writerInfo: Writer,
  input: { value: CheckedSubmission; typedProviderName?: string; authorFixRound: number; media: StoredMedia },
): Promise<ModerationOutcome> {
  try {
    const request = buildModerationRequest({
      language: writerInfo.language,
      text: input.value.text,
      typedProviderName: input.typedProviderName,
      procedureCode: input.value.procedureCode,
      visitMonth: input.value.visitMonth,
      authorFixRound: input.authorFixRound,
    });
    return await moderateTestimony(context, {
      request,
      photoPaths: input.media.photoPaths,
      ...(input.media.proofPath ? { proofPath: input.media.proofPath } : {}),
    });
  } finally {
    if (input.media.proofPath) await deleteTestimonyMedia(writerInfo.uploads, [input.media.proofPath]);
  }
}

/** The kept Proof of Visit result: only when the check ran, never the file. */
function proofRecord(outcome: ModerationOutcome, now: Timestamp): Pick<TestimonyDoc, "proofOfVisit"> {
  const result = outcome.decision.proofOfVisit;
  return result === "accepted" || result === "rejected" ? { proofOfVisit: { result, checkedAt: now } } : {};
}

/** Coordinates for a new Listed Provider (Essentials Place Details). On failure it is listed without them. */
export async function coordinatesFor(context: AppLoadContext, placeId: string): Promise<LatLng | null> {
  const result = await context.adapters.places.getCoordinates(placeId);
  if (result.ok) return result.location;
  context.logger.warn("listed_provider", { outcome: "coordinates_unavailable", reason: result.reason });
  return null;
}

export interface ProviderProposal {
  name: string;
  region: RegionRef;
  providerType: ProviderType;
  location: LatLng | null;
}

/** Aggregates over a place's published Testimonies read in the transaction, with one replaced or left out. */
function aggregatesWith(published: QuerySnapshot, testimonyId: string, self: AggregateInput | null) {
  const list: AggregateInput[] = published.docs
    .filter((doc) => doc.id !== testimonyId)
    .map((doc) => doc.data() as TestimonyDoc);
  if (self) list.push(self);
  return computeAggregates(list);
}

/**
 * The Provider side of a Testimony entering (or changing while) `published`, after
 * every transaction read. A missing Listed Provider is created from the proposal,
 * exactly once even under concurrency: a competing transaction that created it first
 * makes this one retry, see it, and keep the Listed name. Returns the Region and type
 * the Testimony copies.
 */
export function writeProviderOnPublish(
  tx: Transaction,
  input: {
    placeId: string;
    provider: DocumentSnapshot;
    published: QuerySnapshot;
    testimonyId: string;
    self: AggregateInput;
    proposal: ProviderProposal | null;
  },
): { region: RegionRef; providerType: ProviderType } {
  const now = Timestamp.now();
  const aggregates = aggregatesWith(input.published, input.testimonyId, input.self);
  if (input.provider.exists) {
    const listed = input.provider.data() as ProviderDoc;
    tx.update(input.provider.ref, { aggregates, updatedAt: now });
    return { region: listed.region, providerType: listed.providerType };
  }
  const { proposal } = input;
  if (!proposal) throw new Error(`no Listed Provider and no proposed name for ${input.placeId}`);
  const doc: ProviderDoc = {
    placeId: input.placeId,
    name: proposal.name,
    nameSource: "testimonyAuthor",
    nameNormalized: normalizeName(proposal.name),
    region: proposal.region,
    ...(proposal.location ? { location: { ...proposal.location, fetchedAt: now } } : {}),
    providerType: proposal.providerType,
    providerTypeSource: "inferred",
    claimStatus: "unclaimed",
    aggregates,
    listedBy: "testimony",
    createdAt: now,
    updatedAt: now,
  };
  // The Listed Provider count is read from `providers` (impact.server.ts), so no counter moves.
  tx.create(input.provider.ref, doc);
  return { region: proposal.region, providerType: proposal.providerType };
}

/** Recomputes aggregates after a Testimony left `published`. */
export function writeProviderOnUnpublish(
  tx: Transaction,
  provider: DocumentSnapshot,
  published: QuerySnapshot,
  testimonyId: string,
) {
  if (!provider.exists) return;
  tx.update(provider.ref, { aggregates: aggregatesWith(published, testimonyId, null), updatedAt: Timestamp.now() });
}

export const regionValue = (region: RegionRef): RegionRef => ({
  provinceCode: region.provinceCode,
  regencyCode: region.regencyCode,
  ...(region.districtCode ? { districtCode: region.districtCode } : {}),
});

async function invalidResponse(
  request: Request,
  fieldErrors: Record<string, string>,
  onlyFiles: boolean,
): Promise<Response> {
  return errorResponse(request, 400, onlyFiles ? "invalid_file" : "invalid_submission", { fieldErrors });
}

async function activeTestimonyId(firestore: Firestore, uid: string, placeId: string): Promise<string | null> {
  const snapshot = await testimonies(firestore).where("authorUid", "==", uid).where("placeId", "==", placeId).get();
  return snapshot.docs.find((doc) => doc.get("status") !== "deleted")?.id ?? null;
}

async function refusalResponse(request: Request, error: unknown): Promise<Response> {
  if (!(error instanceof TestimonyRefusal)) throw error;
  return errorResponse(request, error.status, error.code, error.testimonyId ? { testimonyId: error.testimonyId } : {});
}

/** POST /api/testimonies: a new Testimony, moderated, then stored in its decided state. */
export async function createTestimony(context: AppLoadContext, request: Request): Promise<Response> {
  const gate = await gateSubmission(context, request);
  if (gate instanceof Response) return gate;
  const { firestore, uploads, user, language, t } = gate;

  const formData = await readForm(request);
  const input = formData ? parseSubmissionJson(formData.get(SUBMISSION_FIELDS.json)) : null;
  if (!formData || !input) return errorResponse(request, 400, "invalid_submission");

  const placeId = typeof input.placeId === "string" && PLACE_ID.test(input.placeId) ? input.placeId : null;
  const providerAtStart = placeId ? await providers(firestore).doc(placeId).get() : null;
  const listedAtStart = providerAtStart?.exists === true;
  const checked = checkSubmission(input, {
    providerFields: listedAtStart ? "ignore" : "require",
    currentMonth: currentMonth(),
    t,
  });
  const files = await readTestimonyFiles(formData, { existingPhotoCount: 0, language });
  if (!checked.ok || !files.ok) {
    const fieldErrors = { ...(checked.ok ? {} : checked.fieldErrors), ...(files.ok ? {} : files.fieldErrors) };
    return invalidResponse(request, fieldErrors, checked.ok);
  }
  const value = checked.value;

  // Fast refusal before any upload; the transaction below is the real guarantee.
  const existing = await activeTestimonyId(firestore, user.uid, value.placeId);
  if (existing) return errorResponse(request, 409, "already_posted", { testimonyId: existing });

  const ref = testimonies(firestore).doc();
  const media = await storeTestimonyMedia(uploads, ref.id, files.files);
  let status: TestimonyStatus;
  try {
    const listedName = listedAtStart ? (providerAtStart?.get("name") as string) : undefined;
    const outcome = await moderate(context, gate, {
      value,
      typedProviderName: listedName ?? value.providerName,
      authorFixRound: 0,
      media,
    });
    // TODO(T13): authorFix returns the flagged spans to the author without storing anything.
    status = statusForDecision(outcome.decision.decision);
    const location = status === "published" && !listedAtStart ? await coordinatesFor(context, value.placeId) : null;
    const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();
    const decided = status;

    await firestore.runTransaction(async (tx) => {
      const mine = await tx.get(
        testimonies(firestore).where("authorUid", "==", user.uid).where("placeId", "==", value.placeId),
      );
      const active = mine.docs.find((doc) => doc.get("status") !== "deleted");
      if (active) throw new TestimonyRefusal(409, "already_posted", active.id);
      const provider = await tx.get(providers(firestore).doc(value.placeId));
      const published = decided === "published" ? await tx.get(publishedOf(firestore, value.placeId)) : null;

      const now = Timestamp.now();
      const verifiedVisit = outcome.decision.proofOfVisit === "accepted";
      const content = contentOf(value, media.photoPaths);
      let region: RegionRef;
      let providerType: ProviderType;
      let proposedProviderName: string | undefined;
      if (provider.exists) {
        ({ region, providerType } = provider.data() as ProviderDoc);
      } else {
        // Not Listed when checked, so the typed name and Region were required.
        if (!value.providerName || !value.region) throw new TestimonyRefusal(400, "invalid_submission");
        region = value.region;
        providerType = inferProviderType({ displayName: value.providerName, types: [] });
        proposedProviderName = value.providerName;
      }
      if (published) {
        ({ region, providerType } = writeProviderOnPublish(tx, {
          placeId: value.placeId,
          provider,
          published,
          testimonyId: ref.id,
          self: { ...content, verifiedVisit },
          proposal: proposedProviderName ? { name: proposedProviderName, region, providerType, location } : null,
        }));
        proposedProviderName = undefined;
      }

      tx.create(
        decisionRef,
        moderationDecisionDoc(
          outcome,
          { subjectType: "testimony", subjectId: ref.id, placeId: value.placeId },
          isSpotCheck(decided === "published", context.config.spotCheckRate),
        ),
      );
      const doc: TestimonyDoc = {
        ...content,
        placeId: value.placeId,
        region: regionValue(region),
        providerType,
        ...(proposedProviderName ? { proposedProviderName } : {}),
        authorUid: user.uid,
        displayName: value.displayName,
        status: decided,
        verifiedVisit,
        ...proofRecord(outcome, now),
        consent: { termsVersion: TESTIMONY_TERMS_VERSION, acceptedAt: now },
        authorFixRounds: decided === "needsAuthorFix" ? 1 : 0,
        moderationDecisionId: decisionRef.id,
        createdAt: now,
        updatedAt: now,
        ...(decided === "published" ? { publishedAt: now } : {}),
      };
      tx.create(ref, doc);
      recordTestimonyTransition(firestore, tx, null, { status: decided, verifiedVisit });
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, media.photoPaths).catch(() => {});
    return refusalResponse(request, error);
  }

  context.logger.info("testimony", { outcome: "created", status });
  const body: TestimonySubmitResponse = { testimonyId: ref.id, status };
  return Response.json(body, { status: 201 });
}

/** The Testimony an author may act on, or the refusal. */
async function ownTestimony(
  firestore: Firestore,
  testimonyId: string,
  uid: string,
): Promise<{ snapshot: DocumentSnapshot; testimony: TestimonyDoc }> {
  if (!TESTIMONY_ID.test(testimonyId)) throw new TestimonyRefusal(404, "not_found");
  const snapshot = await testimonies(firestore).doc(testimonyId).get();
  return { snapshot, testimony: checkOwn(snapshot, uid) };
}

function checkOwn(snapshot: DocumentSnapshot, uid: string): TestimonyDoc {
  const testimony = snapshot.data() as TestimonyDoc | undefined;
  if (!testimony || testimony.status === "deleted") throw new TestimonyRefusal(404, "not_found");
  if (testimony.authorUid !== uid) throw new TestimonyRefusal(403, "forbidden");
  return testimony;
}

export const storedPhotoPaths = (testimony: TestimonyDoc) => [
  ...testimony.photoPaths,
  ...(testimony.pendingRevision?.photoPaths ?? []),
];

const ADMIN_DECIDES: ReadonlySet<TestimonyStatus> = new Set(["held", "rejected"]);

/**
 * POST /api/testimonies/:testimonyId: the author edits. A `published` Testimony keeps
 * its public version while the edit is decided (`pendingRevision`); publish replaces
 * it. Any other editable state is replaced and re-enters Moderation. The Provider
 * never changes. `keepPhotoPaths` must be photos the Testimony already has.
 */
export async function editTestimony(context: AppLoadContext, request: Request, testimonyId: string) {
  const gate = await gateSubmission(context, request);
  if (gate instanceof Response) return gate;
  const { firestore, uploads, user, language, t } = gate;

  let current: TestimonyDoc;
  try {
    ({ testimony: current } = await ownTestimony(firestore, testimonyId, user.uid));
    if (!canAuthorEdit(current.status)) throw new TestimonyRefusal(409, "not_editable");
  } catch (error) {
    return refusalResponse(request, error);
  }

  const formData = await readForm(request);
  const input = formData ? parseSubmissionJson(formData.get(SUBMISSION_FIELDS.json)) : null;
  if (!formData || !input) return errorResponse(request, 400, "invalid_submission");

  const providerAtStart = await providers(firestore).doc(current.placeId).get();
  const listedAtStart = providerAtStart.exists;
  const checked = checkSubmission(
    { ...input, placeId: current.placeId },
    { providerFields: listedAtStart ? "ignore" : "optional", currentMonth: currentMonth(), t },
  );
  const stored = new Set(storedPhotoPaths(current));
  const keep = checked.ok ? checked.value.keepPhotoPaths : [];
  const keepErrors: Record<string, string> = keep.every((path) => stored.has(path))
    ? {}
    : { photos: t("testimonyApi.fields.keepPhotoPaths") };
  const files = await readTestimonyFiles(formData, { existingPhotoCount: keep.length, language });
  if (!checked.ok || !files.ok || keepErrors.photos) {
    const fieldErrors = {
      ...(checked.ok ? {} : checked.fieldErrors),
      ...keepErrors,
      ...(files.ok ? {} : files.fieldErrors),
    };
    return invalidResponse(request, fieldErrors, checked.ok && !keepErrors.photos);
  }
  const value = checked.value;

  const media = await storeTestimonyMedia(uploads, testimonyId, files.files);
  const editingPublished = current.status === "published";
  let decided: TestimonyStatus;
  let orphaned: string[] = [];
  try {
    const proposedName = value.providerName ?? current.proposedProviderName;
    const typedProviderName = listedAtStart ? (providerAtStart.data() as ProviderDoc).name : proposedName;
    const outcome = await moderate(context, gate, {
      value,
      typedProviderName,
      authorFixRound: current.authorFixRounds,
      media,
    });
    // A held or rejected Testimony waits for an admin (ADR-0004): an edit is screened
    // again but cannot Moderate its way past that, so it stays held for the queue.
    decided = ADMIN_DECIDES.has(current.status) ? "held" : statusForDecision(outcome.decision.decision);
    const status = decided;
    const becomesPublished = !editingPublished && status === "published";
    const location = becomesPublished && !listedAtStart ? await coordinatesFor(context, current.placeId) : null;
    const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();
    const ref = testimonies(firestore).doc(testimonyId);

    await firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const before = checkOwn(snapshot, user.uid);
      // Moved meanwhile (an admin hid it, Moderation decided an earlier edit): ask again.
      if (before.status !== current.status || !canAuthorEdit(before.status)) {
        throw new TestimonyRefusal(409, "not_editable");
      }
      const provider = await tx.get(providers(firestore).doc(before.placeId));
      const publicChanges = becomesPublished || (editingPublished && status === "published");
      const published = publicChanges ? await tx.get(publishedOf(firestore, before.placeId)) : null;

      const now = Timestamp.now();
      const content = contentOf(value, [...keep, ...media.photoPaths]);
      const verifiedVisit = before.verifiedVisit || outcome.decision.proofOfVisit === "accepted";
      tx.create(
        decisionRef,
        moderationDecisionDoc(
          outcome,
          {
            subjectType: editingPublished ? "testimonyRevision" : "testimony",
            subjectId: testimonyId,
            placeId: before.placeId,
          },
          isSpotCheck(status === "published", context.config.spotCheckRate),
        ),
      );

      let update: Record<string, unknown>;
      let after: { photoPaths: string[]; pending: string[] };
      if (editingPublished && status !== "published") {
        // The public version stays; the edit, public name included, waits for a decision.
        update = {
          pendingRevision: {
            ...content,
            displayName: value.displayName,
            status,
            submittedAt: now,
            moderationDecisionId: decisionRef.id,
          },
          updatedAt: now,
        };
        after = { photoPaths: before.photoPaths, pending: content.photoPaths };
      } else {
        update = {
          ...contentUpdate(content),
          displayName: value.displayName,
          status,
          verifiedVisit,
          ...proofRecord(outcome, now),
          moderationDecisionId: decisionRef.id,
          pendingRevision: FieldValue.delete(),
          authorFixRounds: before.authorFixRounds + (status === "needsAuthorFix" ? 1 : 0),
          updatedAt: now,
        };
        after = { photoPaths: content.photoPaths, pending: [] };
        let region = before.region;
        let providerType = before.providerType;
        if (!provider.exists && value.region) region = regionValue(value.region);
        if (!provider.exists && value.providerName) {
          update.proposedProviderName = value.providerName;
          providerType = inferProviderType({ displayName: value.providerName, types: [] });
        }
        if (published) {
          ({ region, providerType } = writeProviderOnPublish(tx, {
            placeId: before.placeId,
            provider,
            published,
            testimonyId,
            self: { ...content, verifiedVisit },
            proposal: proposedName ? { name: proposedName, region, providerType, location } : null,
          }));
          update.proposedProviderName = FieldValue.delete();
          if (!editingPublished) update.publishedAt = now;
        }
        update.region = regionValue(region);
        update.providerType = providerType;
        recordTestimonyTransition(
          firestore,
          tx,
          { status: before.status, verifiedVisit: before.verifiedVisit },
          { status, verifiedVisit },
        );
      }
      tx.update(ref, update);
      const kept = new Set([...after.photoPaths, ...after.pending]);
      orphaned = storedPhotoPaths(before).filter((path) => !kept.has(path));
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, media.photoPaths).catch(() => {});
    return refusalResponse(request, error);
  }

  await deleteTestimonyMedia(uploads, orphaned);
  context.logger.info("testimony", { outcome: "edited", status: decided, revision: editingPublished });
  const body: TestimonySubmitResponse = { testimonyId, status: decided };
  return Response.json(body);
}

/**
 * DELETE /api/testimonies/:testimonyId: the author erases their Testimony from any
 * state. Text, photos (and their stored objects), a pending edit and any reply go;
 * aggregates and counters are recomputed when it was published. Not rate limited
 * (erasure must always work), but needs App Check like every write.
 */
export async function deleteTestimony(context: AppLoadContext, request: Request, testimonyId: string) {
  const user = await readSession(context.auth, request.headers.get("cookie"));
  if (!user) return errorResponse(request, 401, "sign_in_required");
  const token = request.headers.get(APP_CHECK_HEADER);
  if (!token || !(await context.adapters.appCheck.verify(token))) {
    return protectionRefusalResponse(request, { ok: false, status: 401, error: "app_check_required" });
  }
  const gate = await writer(context, request, user);
  if (gate instanceof Response) return gate;
  const { firestore, uploads } = gate;
  if (!TESTIMONY_ID.test(testimonyId)) return errorResponse(request, 404, "not_found");

  const ref = testimonies(firestore).doc(testimonyId);
  let removedPaths: string[] = [];
  try {
    await firestore.runTransaction(async (tx) => {
      const before = checkOwn(await tx.get(ref), user.uid);
      const wasPublished = before.status === "published";
      const provider = wasPublished ? await tx.get(providers(firestore).doc(before.placeId)) : null;
      const published = wasPublished ? await tx.get(publishedOf(firestore, before.placeId)) : null;

      const now = Timestamp.now();
      if (provider && published) writeProviderOnUnpublish(tx, provider, published, testimonyId);
      tx.update(ref, {
        status: "deleted",
        deletedAt: now,
        updatedAt: now,
        text: "",
        photoPaths: [],
        pendingRevision: FieldValue.delete(),
        reply: FieldValue.delete(),
        proposedProviderName: FieldValue.delete(),
      });
      recordTestimonyTransition(
        firestore,
        tx,
        { status: before.status, verifiedVisit: before.verifiedVisit },
        { status: "deleted", verifiedVisit: before.verifiedVisit },
      );
      removedPaths = storedPhotoPaths(before);
    });
  } catch (error) {
    return refusalResponse(request, error);
  }

  await deleteTestimonyMedia(uploads, removedPaths);
  context.logger.info("testimony", { outcome: "deleted" });
  const body: TestimonySubmitResponse = { testimonyId, status: "deleted" };
  return Response.json(body);
}

// 'Testimoni saya' ---------------------------------------------------------------

export interface MyTestimony {
  id: string;
  placeId: string;
  /** The Listed name, or the name the author typed while the place is not Listed yet. */
  providerName: string;
  listed: boolean;
  status: TestimonyStatus;
  /** An edit of a published Testimony that is still being decided. */
  pendingStatus?: "submitted" | "needsAuthorFix" | "held";
  /** Admin reason on rejected, removed or sent back to the author. */
  adminReason?: string;
  ratings: AspectRatings;
  text: string;
  visitMonth: string;
  verifiedVisit: boolean;
  /** The Provider's published reply. */
  reply?: string;
  editable: boolean;
}

/** The author's Testimonies that are not deleted, newest first. */
export async function loadMyTestimonies(firestore: Firestore, uid: string): Promise<MyTestimony[]> {
  // Equality only, sorted here: no composite index needed.
  const snapshot = await testimonies(firestore).where("authorUid", "==", uid).get();
  const docs = snapshot.docs
    .map((doc) => ({ id: doc.id, testimony: doc.data() as TestimonyDoc }))
    .filter(({ testimony }) => testimony.status !== "deleted")
    .sort((a, b) => b.testimony.createdAt.toMillis() - a.testimony.createdAt.toMillis());
  const placeIds = [...new Set(docs.map(({ testimony }) => testimony.placeId))];
  const providerSnapshots = placeIds.length
    ? await firestore.getAll(...placeIds.map((id) => providers(firestore).doc(id)))
    : [];
  const names = new Map(
    providerSnapshots.filter((s) => s.exists).map((s) => [s.id, (s.data() as ProviderDoc).name] as const),
  );

  return docs.map(({ id, testimony }) => {
    const listedName = names.get(testimony.placeId);
    return {
      id,
      placeId: testimony.placeId,
      providerName: listedName ?? testimony.proposedProviderName ?? "",
      listed: listedName !== undefined,
      status: testimony.status,
      ...(testimony.pendingRevision ? { pendingStatus: testimony.pendingRevision.status } : {}),
      ...(testimony.adminReason ? { adminReason: testimony.adminReason } : {}),
      ratings: testimony.ratings,
      text: testimony.pendingRevision?.text ?? testimony.text,
      visitMonth: testimony.visitMonth,
      verifiedVisit: testimony.verifiedVisit === true,
      ...(testimony.reply?.status === "published" ? { reply: testimony.reply.text } : {}),
      editable: canAuthorEdit(testimony.status),
    };
  });
}

export type EditableTestimony =
  | { ok: false; status: 403 | 404 | 409 }
  | {
      ok: true;
      testimonyId: string;
      provider: { placeId: string; name: string };
      initial: Partial<TestimonySubmission> & { photos: Array<{ path: string; url: string }> };
    };

/** What the edit page pre-fills: the pending edit if there is one, else the current version. */
export async function loadTestimonyForEdit(
  firestore: Firestore,
  uid: string,
  testimonyId: string,
): Promise<EditableTestimony> {
  let testimony: TestimonyDoc;
  try {
    ({ testimony } = await ownTestimony(firestore, testimonyId, uid));
  } catch (error) {
    if (error instanceof TestimonyRefusal) return { ok: false, status: error.status === 403 ? 403 : 404 };
    throw error;
  }
  if (!canAuthorEdit(testimony.status)) return { ok: false, status: 409 };
  const provider = await providers(firestore).doc(testimony.placeId).get();
  const name = provider.exists ? (provider.data() as ProviderDoc).name : (testimony.proposedProviderName ?? "");
  const content: TestimonyContent = testimony.pendingRevision ?? testimony;
  return {
    ok: true,
    testimonyId,
    provider: { placeId: testimony.placeId, name },
    initial: {
      placeId: testimony.placeId,
      ratings: content.ratings,
      text: content.text,
      visitMonth: content.visitMonth,
      ...(content.procedureCode ? { procedureCode: content.procedureCode } : {}),
      ...(content.pricePaidRupiah !== undefined ? { pricePaidRupiah: content.pricePaidRupiah } : {}),
      displayName: testimony.pendingRevision?.displayName ?? testimony.displayName,
      photos: content.photoPaths.map((path) => ({ path, url: testimonyPhotoUrl(testimonyId, path) })),
    },
  };
}
