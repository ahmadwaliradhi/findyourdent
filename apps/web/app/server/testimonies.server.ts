// Posting, editing and deleting a Testimony (spec 03, T11 and T13), and the author's
// own list for 'Testimoni saya'. Moderation goes through testimony-moderation.server.ts;
// the state machine is testimony-state.ts.
//
// Rules decided here:
// - One Testimony per Patient per Provider among Testimonies that are not `deleted`:
//   an author delete is permanent erasure, so it frees the slot for a new one.
// - Edits count against the five-per-day submission limit (each one runs Moderation).
// - Before a place is Listed, the typed name waits on the Testimony
//   (`proposedProviderName`) and the Region in `region`; the first publish creates the
//   Listed Provider from them. Google's name is never read here, let alone stored.
// - Provider type for a new Listed Provider: the spec 02 rule (`inferProviderType`) on
//   the typed name and Google's types from the Essentials call that fetches its
//   coordinates (held in memory, never stored; never the browser's): a hospital type →
//   hospital, "drg. Nama" → privateDentist, anything else → klinik; `providerTypeSource`
//   "inferred". Without that call's answer, the typed name alone decides.
// - Fix before submit: an authorFix decision is answered with the flagged spans and
//   stores nothing (no Testimony, no decision, no photos); only the round count is kept,
//   per Patient and place (`authorFixCounterId`), until a submission is stored.
import type { ProofOfVisitExtraction } from "@findyourdent/contracts";
import {
  type AspectRatings,
  authorFixCounterId,
  COLLECTIONS,
  type ModerationDecisionDoc,
  type ProofOfVisitExtracted,
  type ProofOfVisitRecord,
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
  type AuthorProofFeedback,
  type AuthorProofStatus,
  authorProofStatus,
  proofStatusKey,
} from "~/lib/proof-status";
import { inferProviderType } from "~/lib/provider-type";
import {
  MAX_AUTHOR_FIX_ROUNDS,
  MAX_PROOF_ATTEMPTS,
  SUBMISSION_FIELDS,
  TESTIMONY_TERMS_VERSION,
  type TestimonyApiError,
  type TestimonyAuthorFixResponse,
  type TestimonyDeleteResponse,
  type TestimonyProofResponse,
  type TestimonyStoredResponse,
  type TestimonySubmission,
} from "~/lib/testimony";
import { testimonyPhotoUrl } from "~/lib/testimony-photos";
import type { LatLng } from "../../server/adapters/places.ts";
import { readSession, type SignedInUser } from "../../server/auth.ts";
import type { Bucket } from "../../server/firebase.ts";
import { jakartaDate } from "../../server/quota.ts";
import { type AggregateInput, computeAggregates } from "./aggregates.ts";
import {
  DETECTION_LOOKBACK_MS,
  type DetectionRuleCode,
  detectionRuleCodes,
  SIMILARITY_COMPARED_STATUSES,
} from "./detection.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import { decideProof } from "./proof-decision.ts";
import { fingerprintOf, type ProofFingerprint } from "./proof-fingerprint.ts";
import { deleteFingerprint, reuseMatchesIn, setFingerprint } from "./proof-fingerprints.server.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import {
  deleteTestimonyMedia,
  readTestimonyFiles,
  type StoredMedia,
  storeTestimonyMedia,
} from "./testimony-media.server.ts";
import {
  checkAttachedProof,
  heldByDetection,
  holdMessage,
  isSpotCheck,
  keptDetection,
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
    ...(value.paymentMethod ? { paymentMethod: value.paymentMethod } : {}),
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
    paymentMethod: content.paymentMethod ?? FieldValue.delete(),
    photoPaths: content.photoPaths,
  };
}

/**
 * Moderates the content with every photo it will have. The caller decides the Proof of
 * Visit and deletes its file unless it is kept for the admin (spec 09); only when
 * Moderation itself throws is the file deleted here.
 */
async function moderate(
  context: AppLoadContext,
  writerInfo: Writer,
  input: {
    value: CheckedSubmission;
    typedProviderName?: string;
    authorFixRound: number;
    /** Edit only: stored photos the edit keeps, screened with the new ones. */
    keptPhotoPaths?: string[];
    media: StoredMedia;
  },
): Promise<ModerationOutcome> {
  try {
    return await moderateTestimony(context, {
      placeId: input.value.placeId,
      language: writerInfo.language,
      text: input.value.text,
      ...(input.typedProviderName ? { typedProviderName: input.typedProviderName } : {}),
      ...(input.value.procedureCode ? { procedureCode: input.value.procedureCode } : {}),
      visitMonth: input.value.visitMonth,
      authorFixRound: input.authorFixRound,
      photoPaths: [...(input.keptPhotoPaths ?? []), ...input.media.photoPaths],
      ...(input.media.proofPath ? { proofPath: input.media.proofPath } : {}),
    });
  } catch (error) {
    if (input.media.proofPath) await deleteTestimonyMedia(writerInfo.uploads, [input.media.proofPath]).catch(() => {});
    throw error;
  }
}

/** An unused round count expires (Firestore TTL on `counters.expiresAt`) after this long. */
const AUTHOR_FIX_COUNTER_DAYS = 30;

const authorFixCounter = (firestore: Firestore, uid: string, placeId: string) =>
  firestore.collection(COLLECTIONS.counters).doc(authorFixCounterId(uid, placeId));

async function authorFixRoundsUsed(firestore: Firestore, uid: string, placeId: string): Promise<number> {
  const snapshot = await authorFixCounter(firestore, uid, placeId).get();
  return (snapshot.get("value") as number | undefined) ?? 0;
}

/**
 * The authorFix answer: spans and message back to the author, nothing stored but the
 * round count. The new photos go; the Proof of Visit is already deleted.
 */
async function authorFixResponse(
  writerInfo: Writer,
  input: {
    placeId: string;
    /** The text as screened; the span offsets point into it. */
    text: string;
    roundsUsed: number;
    outcome: ModerationOutcome;
    newPhotoPaths: string[];
    testimonyId?: string;
  },
): Promise<Response> {
  // A leftover photo is private and unreferenced; the author still gets their answer.
  await deleteTestimonyMedia(writerInfo.uploads, input.newPhotoPaths).catch(() => {});
  const now = Date.now();
  await authorFixCounter(writerInfo.firestore, writerInfo.user.uid, input.placeId).set(
    {
      value: FieldValue.increment(1),
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + AUTHOR_FIX_COUNTER_DAYS * 24 * 60 * 60 * 1000),
    },
    { merge: true },
  );
  const { decision } = input.outcome;
  const body: TestimonyAuthorFixResponse = {
    status: "needsAuthorFix",
    ...(input.testimonyId ? { testimonyId: input.testimonyId } : {}),
    message: decision.authorMessage,
    text: input.text,
    ruleCodes: decision.ruleCodes,
    flaggedSpans: decision.flaggedSpans,
    roundsLeft: Math.max(0, MAX_AUTHOR_FIX_ROUNDS - (input.roundsUsed + 1)),
  };
  return Response.json(body);
}

/**
 * What the author reads once the decision is stored. A detection hold reads the standard
 * held message: no rule, threshold or reason (spec 09 part 2).
 */
function storedFeedback(
  t: TFunction,
  status: "published" | "held",
  outcome: ModerationOutcome,
  options: { withAdmin?: boolean; authorFixRound: number },
): Pick<TestimonyStoredResponse, "message" | "ownHealthDataWarning"> {
  const heldMessage = () =>
    outcome.detectionRuleCodes?.length
      ? t("testimonyApi.moderation.held")
      : holdMessage(t, outcome.decision.ruleCodes, options);
  return {
    message: status === "published" ? t("testimonyApi.moderation.published") : heldMessage(),
    ...(outcome.decision.ownHealthDataWarning ? { ownHealthDataWarning: true } : {}),
  };
}

/** A Proof of Visit sent with this submission, before the reuse check decides it. */
interface SentProof {
  path: string;
  /** Absent when the agent's check did not run. */
  extraction?: ProofOfVisitExtraction;
  extracted: ProofOfVisitExtracted;
  visitMonth: string;
  /** Absent when the proof is rejected whatever the reuse check finds: nothing to compare or keep. */
  fingerprint?: ProofFingerprint;
}

/**
 * The proof sent with this submission or attached later, with its fingerprint computed
 * from the uploaded file while it still exists (spec 09); undefined when none was sent.
 * `extraction` is what the agent read off it, undefined when the check did not run. Runs
 * before the transaction: hashing an image is too slow to repeat on every retry.
 */
async function sentProof(
  extraction: ProofOfVisitExtraction | undefined,
  proofPath: string | undefined,
  file: File | null,
  visitMonth: string,
): Promise<SentProof | undefined> {
  if (!proofPath || !file) return undefined;
  const extracted: ProofOfVisitExtracted = {
    ...(extraction?.clinicNameOnProof ? { clinicName: extraction.clinicNameOnProof } : {}),
    ...(extraction?.proofDate ? { proofDate: extraction.proofDate } : {}),
    ...(extraction?.totalRupiah !== undefined ? { totalRupiah: extraction.totalRupiah } : {}),
  };
  const sent: SentProof = { path: proofPath, ...(extraction ? { extraction } : {}), extracted, visitMonth };
  // Reuse never rejects, so a proof rejected without it is rejected with it.
  if (decideProofSent(sent, false).result === "rejected") return sent;
  // `file.type` is the sniffed type (readTestimonyFiles), not the browser's claim.
  const bytes = Buffer.from(await file.arrayBuffer());
  return { ...sent, fingerprint: await fingerprintOf({ bytes, mimeType: file.type }, extracted) };
}

const decideProofSent = (sent: SentProof, reuse: boolean) =>
  decideProof(sent.extraction, { visitMonth: sent.visitMonth, today: jakartaDate(Date.now()), reuse });

/**
 * The reuse check for a sent proof that has a fingerprint, as a transaction read (so
 * before any write): whether another Testimony at the place holds a matching one.
 */
async function proofReused(
  tx: Transaction,
  firestore: Firestore,
  sent: SentProof,
  ids: { testimonyId: string; placeId: string },
): Promise<boolean> {
  if (!sent.fingerprint) return false;
  return (await reuseMatchesIn(tx, firestore, { ...ids, fingerprint: sent.fingerprint })).length > 0;
}

/**
 * The Proof of Visit decision (spec 09). Keeps the result, its reasons and the facts read
 * off the proof (never the patient's name); a pending proof also keeps its file path for
 * the admin.
 */
function proofRecord(sent: SentProof, reuse: boolean): ProofOfVisitRecord {
  const decided = decideProofSent(sent, reuse);
  const checkedAt = Timestamp.now();
  // The facts read are kept only for a proof that counts or may count (GLOSSARY: Proof Fingerprint).
  if (decided.result === "rejected") return { checkedAt, ...decided };
  const base = { checkedAt, ...(Object.keys(sent.extracted).length > 0 ? { extracted: sent.extracted } : {}) };
  return decided.result === "pending" ? { ...base, ...decided, filePath: sent.path } : { ...base, ...decided };
}

/**
 * The fingerprint follows the proof stored on the Testimony: kept for accepted and
 * pending, gone for rejected (which may replace a pending proof that had one).
 */
function writeProofFingerprint(
  tx: Transaction,
  firestore: Firestore,
  sent: SentProof,
  record: ProofOfVisitRecord,
  ids: { testimonyId: string; placeId: string },
): void {
  if (record.result !== "rejected" && sent.fingerprint)
    setFingerprint(tx, firestore, { ...ids, fingerprint: sent.fingerprint });
  else deleteFingerprint(tx, firestore, ids.testimonyId);
}

/** What the author reads about the proof sent with this submission. */
function proofFeedback(t: TFunction, record: ProofOfVisitRecord | undefined): { proof?: AuthorProofFeedback } {
  if (!record) return {};
  const status = authorProofStatus(record);
  return { proof: { ...status, message: t(proofStatusKey(status)) } };
}

/** What one Essentials Place Details call tells a new Listed Provider. `types` is never stored. */
export interface PlaceEssentials {
  location: LatLng | null;
  types: string[];
}

/** Coordinates and Google's types for a new Listed Provider. On failure it is listed without them. */
export async function placeEssentialsFor(context: AppLoadContext, placeId: string): Promise<PlaceEssentials> {
  const result = await context.adapters.places.getCoordinates(placeId);
  if (result.ok) return { location: result.location, types: result.types };
  context.logger.warn("listed_provider", { outcome: "coordinates_unavailable", reason: result.reason });
  return { location: null, types: [] };
}

/** Before any Essentials call: nothing known from Google. */
export const NO_ESSENTIALS: PlaceEssentials = { location: null, types: [] };

export interface ProviderProposal {
  name: string;
  region: RegionRef;
  essentials: PlaceEssentials;
}

/** The inferred type of a new Listed Provider: the typed name and Google's types (spec 02). */
export function proposedProviderType(name: string, essentials: PlaceEssentials): ProviderType {
  return inferProviderType({ displayName: name, types: essentials.types });
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
  const { location } = proposal.essentials;
  const providerType = proposedProviderType(proposal.name, proposal.essentials);
  const doc: ProviderDoc = {
    placeId: input.placeId,
    name: proposal.name,
    nameSource: "testimonyAuthor",
    nameNormalized: normalizeName(proposal.name),
    region: proposal.region,
    ...(location ? { location: { ...location, fetchedAt: now } } : {}),
    providerType,
    providerTypeSource: "inferred",
    claimStatus: "unclaimed",
    aggregates,
    listedBy: "testimony",
    createdAt: now,
    updatedAt: now,
  };
  // The Listed Provider count is read from `providers` (impact.server.ts), so no counter moves.
  tx.create(input.provider.ref, doc);
  return { region: proposal.region, providerType };
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

/**
 * Detection for a new Testimony (spec 09 part 2): the triggers it fires, from when the
 * Provider's other Testimonies that are not deleted were submitted (D1) and the text of
 * its published and held ones (D2). Read in the transaction that creates it, so a
 * concurrent create makes one of them retry and see the other; a burst or a template
 * sent at once cannot all slip through.
 */
async function detectOnCreate(
  tx: Transaction,
  firestore: Firestore,
  placeId: string,
  text: string,
): Promise<DetectionRuleCode[]> {
  const nowMs = Date.now();
  const [recent, comparable] = await Promise.all([
    tx.get(
      testimonies(firestore)
        .where("placeId", "==", placeId)
        .where("createdAt", ">=", Timestamp.fromMillis(nowMs - DETECTION_LOOKBACK_MS)),
    ),
    tx.get(
      testimonies(firestore)
        .where("placeId", "==", placeId)
        .where("status", "in", [...SIMILARITY_COMPARED_STATUSES]),
    ),
  ]);
  const otherSubmittedAtMs = recent.docs
    .filter((doc) => doc.get("status") !== "deleted")
    .map((doc) => (doc.get("createdAt") as Timestamp).toMillis());
  const comparableTexts = comparable.docs.map((doc) => doc.get("text") as string);
  return detectionRuleCodes({ otherSubmittedAtMs, nowMs, text, comparableTexts });
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
  const roundsUsed = await authorFixRoundsUsed(firestore, user.uid, value.placeId);
  const media = await storeTestimonyMedia(uploads, ref.id, files.files);
  let outcome: ModerationOutcome;
  try {
    const listedName = listedAtStart ? (providerAtStart?.get("name") as string) : undefined;
    outcome = await moderate(context, gate, {
      value,
      typedProviderName: listedName ?? value.providerName,
      authorFixRound: roundsUsed,
      media,
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, media.photoPaths).catch(() => {});
    throw error;
  }
  // Decided in the transaction (the reuse check reads there); it holds only once committed.
  let proof = undefined as ProofOfVisitRecord | undefined;
  // Only a pending proof keeps its file, and only once the Testimony is stored (spec 09).
  let proofKept = false;
  try {
    if (outcome.decision.decision === "authorFix") {
      context.logger.info("testimony", { outcome: "author_fix", round: roundsUsed + 1 });
      return await authorFixResponse(gate, {
        placeId: value.placeId,
        text: value.text,
        roundsUsed,
        outcome,
        newPhotoPaths: media.photoPaths,
      });
    }
    let verifiedVisit = false;
    const moderated = outcome;
    const moderatedDecision = outcome.decision.decision;
    // Set by the committed attempt of the transaction (which may retry): detection there
    // may still turn Moderation's publish into hold.
    let stored: { status: "published" | "held"; outcome: ModerationOutcome; detected: DetectionRuleCode[] } = {
      status: statusForDecision(moderatedDecision),
      outcome: moderated,
      detected: [],
    };
    try {
      const sent = await sentProof(outcome.decision.proofOfVisit, media.proofPath, files.files.proof, value.visitMonth);
      // Only a publish of a place not Listed yet needs Google's coordinates and types. Fetched
      // before the transaction, never in it, even when detection then holds it.
      const essentials =
        moderatedDecision === "publish" && !listedAtStart
          ? await placeEssentialsFor(context, value.placeId)
          : NO_ESSENTIALS;
      const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();

      await firestore.runTransaction(async (tx) => {
        const mine = await tx.get(
          testimonies(firestore).where("authorUid", "==", user.uid).where("placeId", "==", value.placeId),
        );
        const active = mine.docs.find((doc) => doc.get("status") !== "deleted");
        if (active) throw new TestimonyRefusal(409, "already_posted", active.id);
        // Detection only ever turns Moderation's publish into hold. A failed read fails the request.
        const detected =
          moderatedDecision === "publish" ? await detectOnCreate(tx, firestore, value.placeId, value.text) : [];
        const attemptOutcome = detected.length > 0 ? heldByDetection(t, moderated, detected) : moderated;
        const status = detected.length > 0 ? "held" : statusForDecision(moderatedDecision);
        const provider = await tx.get(providers(firestore).doc(value.placeId));
        const published = status === "published" ? await tx.get(publishedOf(firestore, value.placeId)) : null;
        const ids = { testimonyId: ref.id, placeId: value.placeId };
        const reused = sent ? await proofReused(tx, firestore, sent, ids) : false;

        // Assigned on every attempt: a retry may see a fingerprint the first did not.
        proof = sent ? proofRecord(sent, reused) : undefined;
        verifiedVisit = proof?.result === "accepted";
        if (sent && proof) writeProofFingerprint(tx, firestore, sent, proof, ids);
        const now = Timestamp.now();
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
            proposal: proposedProviderName ? { name: proposedProviderName, region, essentials } : null,
          }));
          proposedProviderName = undefined;
        }

        tx.create(
          decisionRef,
          moderationDecisionDoc(
            attemptOutcome,
            { subjectType: "testimony", subjectId: ref.id, placeId: value.placeId },
            isSpotCheck(status === "published", context.config.spotCheckRate),
          ),
        );
        tx.delete(authorFixCounter(firestore, user.uid, value.placeId));
        const doc: TestimonyDoc = {
          ...content,
          placeId: value.placeId,
          region: regionValue(region),
          providerType,
          ...(proposedProviderName ? { proposedProviderName } : {}),
          authorUid: user.uid,
          displayName: value.displayName,
          status,
          verifiedVisit,
          ...(proof ? { proofOfVisit: proof, proofAttempts: 1 } : {}),
          consent: { termsVersion: TESTIMONY_TERMS_VERSION, acceptedAt: now },
          authorFixRounds: roundsUsed,
          moderationDecisionId: decisionRef.id,
          createdAt: now,
          updatedAt: now,
          ...(status === "published" ? { publishedAt: now } : {}),
        };
        tx.create(ref, doc);
        recordTestimonyTransition(firestore, tx, null, { status, verifiedVisit });
        stored = { status, outcome: attemptOutcome, detected };
      });
    } catch (error) {
      await deleteTestimonyMedia(uploads, media.photoPaths).catch(() => {});
      return await refusalResponse(request, error);
    }
    proofKept = proof?.result === "pending";
    const { status } = stored;

    if (stored.detected.length > 0) {
      context.logger.info("testimony", { outcome: "held_by_detection", detection: stored.detected.join(",") });
    }
    context.logger.info("testimony", { outcome: "created", status, ...(proof ? { proof: proof.result } : {}) });
    const body: TestimonyStoredResponse = {
      testimonyId: ref.id,
      status,
      ...storedFeedback(t, status, stored.outcome, { authorFixRound: roundsUsed }),
      verifiedVisit,
      ...proofFeedback(t, proof),
    };
    return Response.json(body, { status: 201 });
  } finally {
    // Best effort: the Testimony is already stored; a leftover private file is not worth a 500.
    if (media.proofPath && !proofKept) await deleteTestimonyMedia(uploads, [media.proofPath]).catch(() => {});
  }
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

/** Proofs checked so far; a Testimony stored before they were counted has had one if it has a proof. */
const proofAttemptsOf = (testimony: TestimonyDoc) => testimony.proofAttempts ?? (testimony.proofOfVisit ? 1 : 0);

/** Proofs the author may still have checked for this Testimony (spec 09). */
export const proofAttemptsLeft = (testimony: TestimonyDoc) =>
  Math.max(0, MAX_PROOF_ATTEMPTS - proofAttemptsOf(testimony));

type ProofRefusal = "proof_not_allowed" | "proof_pending" | "proof_attempts_used";

/**
 * Why a new proof may not replace the Testimony's current one, or null when it may: a
 * proof waiting for the admin is never replaced (a held receipt cannot be wiped before
 * the team sees it), and every proof attempt may be used up (spec 09).
 */
function newProofRefusal(testimony: TestimonyDoc): ProofRefusal | null {
  if (testimony.proofOfVisit?.result === "pending") return "proof_pending";
  return proofAttemptsLeft(testimony) ? null : "proof_attempts_used";
}

/**
 * Why the author may not attach a Proof of Visit now, or null when they may: only to a
 * published Testimony without an accepted proof, none waiting for the admin, while proof
 * attempts are left.
 */
function proofRefusal(testimony: TestimonyDoc): ProofRefusal | null {
  if (testimony.status !== "published" || testimony.proofOfVisit?.result === "accepted") return "proof_not_allowed";
  return newProofRefusal(testimony);
}

function checkProofAllowed(testimony: TestimonyDoc): void {
  const refusal = proofRefusal(testimony);
  if (refusal) throw new TestimonyRefusal(409, refusal);
}

export const canAttachProof = (testimony: TestimonyDoc) => proofRefusal(testimony) === null;

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
  // An accepted proof is never replaced, so an edit's proof is then left unused (below).
  const editProofRefusal =
    files.files.proof && current.proofOfVisit?.result !== "accepted" ? newProofRefusal(current) : null;
  if (editProofRefusal) return errorResponse(request, 409, editProofRefusal);

  const roundsUsed = await authorFixRoundsUsed(firestore, user.uid, current.placeId);
  const media = await storeTestimonyMedia(uploads, testimonyId, files.files);
  const editingPublished = current.status === "published";
  const proposedName = value.providerName ?? current.proposedProviderName;
  let outcome: ModerationOutcome;
  try {
    const typedProviderName = listedAtStart ? (providerAtStart.data() as ProviderDoc).name : proposedName;
    outcome = await moderate(context, gate, {
      value,
      typedProviderName,
      authorFixRound: roundsUsed,
      keptPhotoPaths: keep,
      media,
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, media.photoPaths).catch(() => {});
    throw error;
  }
  // The edit's proof as stored on the Testimony, once committed: an accepted proof is never
  // replaced, and an edit that waits as a pending revision does not touch the proof.
  let proofApplied = undefined as ProofOfVisitRecord | undefined;
  try {
    if (outcome.decision.decision === "authorFix") {
      // The Testimony stays exactly as it was until the author sends a fixed edit.
      context.logger.info("testimony", { outcome: "author_fix", round: roundsUsed + 1, revision: editingPublished });
      return await authorFixResponse(gate, {
        placeId: current.placeId,
        text: value.text,
        roundsUsed,
        outcome,
        newPhotoPaths: media.photoPaths,
        testimonyId,
      });
    }
    // A held or rejected Testimony waits for an admin (ADR-0004): an edit is screened
    // again but cannot Moderate its way past that, so it stays held for the queue.
    const withAdmin = ADMIN_DECIDES.has(current.status);
    const decided: "published" | "held" = withAdmin ? "held" : statusForDecision(outcome.decision.decision);
    let verifiedVisitAfter = current.verifiedVisit;
    let orphaned: string[] = [];
    // Set in the transaction (which may retry); it counts only once the edit is committed.
    let proofInEdit = undefined as ProofOfVisitRecord | undefined;
    try {
      const status = decided;
      const becomesPublished = !editingPublished && status === "published";
      // A published Testimony whose edit is not published keeps the edit as a pending revision.
      const editWaits = editingPublished && status !== "published";
      const sent = editWaits
        ? undefined
        : await sentProof(outcome.decision.proofOfVisit, media.proofPath, files.files.proof, value.visitMonth);
      const essentials =
        becomesPublished && !listedAtStart ? await placeEssentialsFor(context, current.placeId) : NO_ESSENTIALS;
      const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();
      const ref = testimonies(firestore).doc(testimonyId);

      await firestore.runTransaction(async (tx) => {
        proofInEdit = undefined;
        const snapshot = await tx.get(ref);
        const before = checkOwn(snapshot, user.uid);
        // Moved meanwhile (an admin hid it, Moderation decided an earlier edit): ask again.
        if (before.status !== current.status || !canAuthorEdit(before.status)) {
          throw new TestimonyRefusal(409, "not_editable");
        }
        const provider = await tx.get(providers(firestore).doc(before.placeId));
        const publicChanges = becomesPublished || (editingPublished && status === "published");
        const published = publicChanges ? await tx.get(publishedOf(firestore, before.placeId)) : null;
        // A detection hold still waiting for the admin keeps its triggers on the new decision
        // (spec 09 part 2); once an admin has decided it, they are not carried.
        const heldDecision =
          before.status === "held" && before.moderationDecisionId
            ? await tx.get(firestore.collection(COLLECTIONS.moderationDecisions).doc(before.moderationDecisionId))
            : null;
        const heldBy = (heldDecision?.data() as ModerationDecisionDoc | undefined)?.detectionRuleCodes ?? [];
        const decisionOutcome = heldBy.length > 0 ? keptDetection(outcome, heldBy) : outcome;
        const ids = { testimonyId, placeId: before.placeId };
        // Never an accepted proof, nor one waiting for the admin (refused above unless it got there meanwhile).
        const replaceable = before.proofOfVisit === undefined || before.proofOfVisit.result === "rejected";
        const replacing = sent && replaceable ? sent : undefined;
        const reused = replacing ? await proofReused(tx, firestore, replacing, ids) : false;

        const now = Timestamp.now();
        const content = contentOf(value, [...keep, ...media.photoPaths]);
        const proof = replacing ? proofRecord(replacing, reused) : undefined;
        const verifiedVisit = before.verifiedVisit || proof?.result === "accepted";
        tx.create(
          decisionRef,
          moderationDecisionDoc(
            decisionOutcome,
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
        if (editWaits) {
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
            ...(proof ? { proofOfVisit: proof, proofAttempts: proofAttemptsOf(before) + 1 } : {}),
            moderationDecisionId: decisionRef.id,
            pendingRevision: FieldValue.delete(),
            authorFixRounds: roundsUsed,
            updatedAt: now,
          };
          after = { photoPaths: content.photoPaths, pending: [] };
          verifiedVisitAfter = verifiedVisit;
          proofInEdit = proof;
          if (replacing && proof) writeProofFingerprint(tx, firestore, replacing, proof, ids);
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
              proposal: proposedName ? { name: proposedName, region, essentials } : null,
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
        tx.delete(authorFixCounter(firestore, user.uid, before.placeId));
        const kept = new Set([...after.photoPaths, ...after.pending]);
        orphaned = storedPhotoPaths(before).filter((path) => !kept.has(path));
      });
    } catch (error) {
      await deleteTestimonyMedia(uploads, media.photoPaths).catch(() => {});
      return await refusalResponse(request, error);
    }
    proofApplied = proofInEdit;

    await deleteTestimonyMedia(uploads, orphaned);
    context.logger.info("testimony", { outcome: "edited", status: decided, revision: editingPublished });
    const body: TestimonyStoredResponse = {
      testimonyId,
      status: decided,
      ...storedFeedback(t, decided, outcome, { withAdmin, authorFixRound: roundsUsed }),
      verifiedVisit: verifiedVisitAfter,
      ...proofFeedback(t, proofApplied),
    };
    return Response.json(body);
  } finally {
    // Best effort: the edit is already answered; a leftover private file is not worth a 500.
    if (media.proofPath && proofApplied?.result !== "pending") {
      await deleteTestimonyMedia(uploads, [media.proofPath]).catch(() => {});
    }
  }
}

/**
 * POST /api/testimonies/:testimonyId/proof: the author attaches a Proof of Visit to their
 * published Testimony (spec 09). Moderation runs in proof-only mode: the text and photos
 * are not screened again, nothing goes to `pendingRevision` and the public Testimony stays
 * as it is. The same proof decision applies as at submission; an accepted proof makes it
 * Proven, so the aggregates and the impact counter move. Uses the per-account limit for
 * submissions and edits.
 */
export async function attachProof(context: AppLoadContext, request: Request, testimonyId: string) {
  const gate = await gateSubmission(context, request);
  if (gate instanceof Response) return gate;
  const { firestore, uploads, user, language, t } = gate;

  let current: TestimonyDoc;
  try {
    ({ testimony: current } = await ownTestimony(firestore, testimonyId, user.uid));
    checkProofAllowed(current);
  } catch (error) {
    return refusalResponse(request, error);
  }

  const formData = await readForm(request);
  if (!formData) return errorResponse(request, 400, "invalid_file");
  const files = await readTestimonyFiles(formData, { existingPhotoCount: 0, language });
  if (!files.ok) return invalidResponse(request, files.fieldErrors, true);
  const { proof: file } = files.files;
  if (!file || files.files.photos.length > 0) {
    return invalidResponse(request, { proof: t("testimonyApi.fields.proofRequired") }, true);
  }

  const providerAtStart = await providers(firestore).doc(current.placeId).get();
  const typedProviderName = providerAtStart.exists
    ? (providerAtStart.data() as ProviderDoc).name
    : current.proposedProviderName;
  const media = await storeTestimonyMedia(uploads, testimonyId, { photos: [], proof: file });
  const proofPath = media.proofPath as string;
  // Only a pending proof keeps its file, and only once it is stored on the Testimony.
  let proofKept = false;
  try {
    const extraction = await checkAttachedProof(context, {
      placeId: current.placeId,
      language,
      visitMonth: current.visitMonth,
      ...(typedProviderName ? { typedProviderName } : {}),
      proofPath,
    });
    // `sentProof` is defined: a path and a file were both given.
    const sent = (await sentProof(extraction, proofPath, file, current.visitMonth)) as SentProof;
    // Reuse can only hold an acceptable proof back, so the Provider is read whenever it may be accepted.
    const mayAccept = decideProofSent(sent, false).result === "accepted";
    // Decided in the transaction (the reuse check reads there); it holds only once committed.
    let decided: ProofOfVisitRecord | undefined;
    let after: TestimonyDoc | undefined;
    try {
      const ref = testimonies(firestore).doc(testimonyId);
      await firestore.runTransaction(async (tx) => {
        const before = checkOwn(await tx.get(ref), user.uid);
        // Moved meanwhile (unpublished, another proof stored, attempts used): ask again.
        checkProofAllowed(before);
        const provider = mayAccept ? await tx.get(providers(firestore).doc(before.placeId)) : null;
        const published = mayAccept ? await tx.get(publishedOf(firestore, before.placeId)) : null;
        const ids = { testimonyId, placeId: before.placeId };
        const proof = proofRecord(sent, await proofReused(tx, firestore, sent, ids));
        const verifiedVisit = proof.result === "accepted";
        decided = proof;

        const attempts = proofAttemptsOf(before) + 1;
        after = {
          ...before,
          proofOfVisit: proof,
          proofAttempts: attempts,
          verifiedVisit: before.verifiedVisit || verifiedVisit,
        };
        writeProofFingerprint(tx, firestore, sent, proof, ids);
        if (verifiedVisit && provider && published) {
          writeProviderOnPublish(tx, {
            placeId: before.placeId,
            provider,
            published,
            testimonyId,
            self: { ...before, verifiedVisit: true },
            proposal: null,
          });
        }
        tx.update(ref, {
          proofOfVisit: proof,
          proofAttempts: attempts,
          ...(verifiedVisit ? { verifiedVisit: true } : {}),
          updatedAt: Timestamp.now(),
        });
        recordTestimonyTransition(
          firestore,
          tx,
          { status: before.status, verifiedVisit: before.verifiedVisit },
          { status: before.status, verifiedVisit: before.verifiedVisit || verifiedVisit },
        );
      });
    } catch (error) {
      return await refusalResponse(request, error);
    }
    // Both set by the committed transaction; TypeScript cannot see the assignments in the callback.
    const proof = decided as unknown as ProofOfVisitRecord;
    const stored = after as unknown as TestimonyDoc;
    const verifiedVisit = proof.result === "accepted";
    proofKept = proof.result === "pending";

    context.logger.info("testimony", { outcome: "proof_attached", proof: proof.result });
    const body: TestimonyProofResponse = {
      testimonyId,
      verifiedVisit,
      proof: proofFeedback(t, proof).proof as TestimonyProofResponse["proof"],
      proofAttemptsLeft: proofAttemptsLeft(stored),
      canAttachProof: canAttachProof(stored),
    };
    return Response.json(body);
  } finally {
    if (!proofKept) await deleteTestimonyMedia(uploads, [proofPath]).catch(() => {});
  }
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
        // A proof waiting for the admin goes with its file; a decided one keeps only its result.
        ...(before.proofOfVisit?.result === "pending" ? { proofOfVisit: FieldValue.delete() } : {}),
      });
      // Erasure takes the fingerprint too, accepted or not, which frees the receipt (spec 09).
      deleteFingerprint(tx, firestore, testimonyId);
      recordTestimonyTransition(
        firestore,
        tx,
        { status: before.status, verifiedVisit: before.verifiedVisit },
        { status: "deleted", verifiedVisit: before.verifiedVisit },
      );
      removedPaths = [
        ...storedPhotoPaths(before),
        ...(before.proofOfVisit?.result === "pending" ? [before.proofOfVisit.filePath] : []),
      ];
    });
  } catch (error) {
    return refusalResponse(request, error);
  }

  await deleteTestimonyMedia(uploads, removedPaths);
  context.logger.info("testimony", { outcome: "deleted" });
  const body: TestimonyDeleteResponse = { testimonyId, status: "deleted" };
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
  /** The Proof of Visit decision, when one was sent. */
  proof?: AuthorProofStatus;
  /** Published without an accepted proof, with proof attempts left: one may be attached now. */
  canAttachProof: boolean;
  proofAttemptsLeft: number;
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
      ...(testimony.proofOfVisit ? { proof: authorProofStatus(testimony.proofOfVisit) } : {}),
      canAttachProof: canAttachProof(testimony),
      proofAttemptsLeft: proofAttemptsLeft(testimony),
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
      ...(content.paymentMethod ? { paymentMethod: content.paymentMethod } : {}),
      displayName: testimony.pendingRevision?.displayName ?? testimony.displayName,
      photos: content.photoPaths.map((path) => ({ path, url: testimonyPhotoUrl(testimonyId, path) })),
    },
  };
}
