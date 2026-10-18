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
//   the typed name alone, with no Google types (no extra paid call): "drg. Nama" →
//   privateDentist, anything else → klinik; `providerTypeSource` "inferred".
// - Fix before submit: an authorFix decision is answered with the flagged spans and
//   stores nothing (no Testimony, no decision, no photos); only the round count is kept,
//   per Patient and place (`authorFixCounterId`), until a submission is stored.
// - Proof of Visit (spec 09): the agent reads the facts, `decideProof` decides. The file
//   is deleted once the result is accepted or rejected (or the proof could not be
//   checked); a pending one stays for an admin. An edit may carry a new proof: it
//   replaces a proof that is not accepted yet and counts as another attempt; a Testimony
//   already proven keeps its proof and the new file is simply deleted. A published
//   Testimony takes a proof later too (`attachProof`, proof-only Moderation). Every
//   proof checked is an attempt, 3 per Testimony; a fourth is refused before any model
//   call, and a proof the agent could not read uses none.
// - Proof Fingerprint (spec 09): taken from the stored file before the decision, which
//   runs inside the transaction storing the result so the reuse check (the place's
//   fingerprints) cannot be raced. Accepted and pending proofs keep one, replacing the
//   Testimony's previous one; a rejected proof or an author delete drops it.
import type { ProofExtraction } from "@findyourdent/contracts";
import {
  type AspectRatings,
  authorFixCounterId,
  COLLECTIONS,
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
  decideProof,
  MAX_PROOF_ATTEMPTS,
  type ProofDecision,
  type ProofOfVisitStatus,
  proofStatusForAuthor,
} from "~/lib/proof-decision";
import {
  MAX_AUTHOR_FIX_ROUNDS,
  type ProofAttachResponse,
  SUBMISSION_FIELDS,
  TESTIMONY_TERMS_VERSION,
  type TestimonyApiError,
  type TestimonyAuthorFixResponse,
  type TestimonyDeleteResponse,
  type TestimonyStoredResponse,
  type TestimonySubmission,
} from "~/lib/testimony";
import { testimonyPhotoUrl } from "~/lib/testimony-photos";
import type { LatLng } from "../../server/adapters/places.ts";
import { readSession, type SignedInUser } from "../../server/auth.ts";
import type { Bucket } from "../../server/firebase.ts";
import { storedProofPaths } from "../../server/proof-files.ts";
import { jakartaDate } from "../../server/quota.ts";
import { type AggregateInput, computeAggregates } from "./aggregates.ts";
import { recordTestimonyTransition } from "./impact.server.ts";
import {
  fingerprintRef,
  fingerprintStoredProof,
  type ProofFingerprint,
  recordFingerprint,
  reusedIn,
} from "./proof-fingerprint.server.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { inferProviderType } from "./shortlist.server.ts";
import {
  deleteTestimonyMedia,
  readProofFile,
  readTestimonyFiles,
  type StoredMedia,
  storeTestimonyMedia,
} from "./testimony-media.server.ts";
import {
  checkProofOnly,
  holdMessage,
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

/**
 * Moderates the content with every photo it will have, and has the Proof of Visit read.
 * The caller deletes the new files when anything fails, and the proof file once decided.
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
    await deleteTestimonyMedia(writerInfo.uploads, newPaths(input.media)).catch(() => {});
    throw error;
  }
}

/** The objects one submission wrote: its new photos and its Proof of Visit. */
const newPaths = (media: StoredMedia) => [...media.photoPaths, ...(media.proofPath ? [media.proofPath] : [])];

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
 * round count. The new photos and the Proof of Visit go (the proof was not decided, so
 * it is no attempt: the form keeps it for the next Kirim).
 */
async function authorFixResponse(
  writerInfo: Writer,
  input: {
    placeId: string;
    /** The text as screened; the span offsets point into it. */
    text: string;
    roundsUsed: number;
    outcome: ModerationOutcome;
    media: StoredMedia;
    testimonyId?: string;
  },
): Promise<Response> {
  // A leftover file is private and unreferenced; the author still gets their answer.
  await deleteTestimonyMedia(writerInfo.uploads, newPaths(input.media)).catch(() => {});
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

/** What the author reads once the decision is stored. */
function storedFeedback(
  t: TFunction,
  status: "published" | "held",
  outcome: ModerationOutcome,
  options: { withAdmin?: boolean; authorFixRound: number },
): Pick<TestimonyStoredResponse, "message" | "ownHealthDataWarning"> {
  return {
    message:
      status === "published"
        ? t("testimonyApi.moderation.published")
        : holdMessage(t, outcome.decision.ruleCodes, options),
    ...(outcome.decision.ownHealthDataWarning ? { ownHealthDataWarning: true } : {}),
  };
}

// Proof of Visit (spec 09) ------------------------------------------------------

/** What the agent read from a proof, and the Proof Fingerprint of its stored file. */
type ReadProof = { checked: true; extraction: ProofExtraction; fingerprint: ProofFingerprint };
/** A proof ready for the decision, or `checked: false` when the agent could not read it. */
type ProofRead = { checked: false } | ReadProof;
/** The decided Proof of Visit, or `checked: false` when the agent could not read it. */
type ProofCheck = { checked: false } | CheckedProof;
type CheckedProof = ReadProof & { decision: ProofDecision };

/** Reads the proof sent with a submission or an edit: what the agent read, and its fingerprint. */
async function readProof(
  context: AppLoadContext,
  uploads: Bucket,
  outcome: ModerationOutcome,
  proofPath: string,
): Promise<ProofRead> {
  const extraction = outcome.decision.proofExtraction;
  return extraction ? fingerprinted(context, uploads, extraction, proofPath) : { checked: false };
}

/**
 * The Proof Fingerprint of a stored proof file, taken before the decision can delete it.
 * A file that cannot be fingerprinted is not checked at all, like one the agent could not
 * read: no decision without the reuse check.
 */
async function fingerprinted(
  context: AppLoadContext,
  uploads: Bucket,
  extraction: ProofExtraction,
  proofPath: string,
): Promise<ProofRead> {
  try {
    return { checked: true, extraction, fingerprint: await fingerprintStoredProof(uploads, proofPath, extraction) };
  } catch (error) {
    context.logger.warn("testimony", {
      outcome: "proof_fingerprint_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
    return { checked: false };
  }
}

/**
 * The proof decision on what the agent read, at submission, with an edit or attached
 * later. Runs inside the transaction that stores the result: the reuse check reads the
 * place's fingerprints there, so two Testimonies sent at once with one receipt cannot
 * both pass it.
 */
async function decidedProof(
  tx: Transaction,
  firestore: Firestore,
  proof: ReadProof,
  at: { testimonyId: string; placeId: string; visitMonth: string },
): Promise<CheckedProof> {
  const reused = await reusedIn(tx, firestore, { ...at, fingerprint: proof.fingerprint });
  const decision = decideProof({
    extraction: proof.extraction,
    visitMonth: at.visitMonth,
    today: jakartaDate(Date.now()),
    reuse: { matched: reused.length > 0 },
  });
  return { ...proof, decision };
}

/**
 * In the transaction storing the result: the fingerprint of an accepted or pending proof
 * replaces the Testimony's; a rejected one drops it.
 */
function keepFingerprint(
  tx: Transaction,
  firestore: Firestore,
  at: { testimonyId: string; placeId: string },
  proof: CheckedProof,
  now: Timestamp,
): void {
  recordFingerprint(tx, firestore, { ...at, fingerprint: proof.fingerprint, now }, proof.decision.result);
}

/** What is kept of a decided proof: never the file, never a patient name. */
function proofRecord({ decision, extraction }: CheckedProof, attempts: number, now: Timestamp): ProofOfVisitRecord {
  return {
    result: decision.result,
    ...(decision.result === "pending" ? { reasons: decision.reasons } : {}),
    ...(decision.result === "rejected" ? { reason: decision.reason } : {}),
    checkedAt: now,
    ...(extraction.clinicNameOnProof ? { clinicNameOnProof: extraction.clinicNameOnProof } : {}),
    ...(extraction.proofDate ? { proofDate: extraction.proofDate } : {}),
    ...(extraction.totalRupiah !== undefined ? { totalRupiah: extraction.totalRupiah } : {}),
    attempts,
  };
}

/** Proofs checked so far for a Testimony; a proof checked before spec 09 counts as one. */
const proofAttempts = (testimony: TestimonyDoc) =>
  testimony.proofOfVisit ? (testimony.proofOfVisit.attempts ?? 1) : 0;

/** Proofs the author may still send for a Testimony (spec 09: 3 in all, the first included). */
const proofAttemptsLeft = (testimony: TestimonyDoc) => Math.max(0, MAX_PROOF_ATTEMPTS - proofAttempts(testimony));

/** A Proven Testimony, or one whose proof was accepted while it was not published. */
const hasAcceptedProof = (testimony: TestimonyDoc) =>
  testimony.verifiedVisit || testimony.proofOfVisit?.result === "accepted";

/**
 * Every proof attempt is used, so another proof is refused before any model call. A
 * proof sent for an accepted one is no attempt: it is never checked.
 */
const proofAttemptsUsed = (testimony: TestimonyDoc) =>
  !hasAcceptedProof(testimony) && proofAttemptsLeft(testimony) === 0;

/** What the author reads about the proof they sent. */
const proofFeedback = (proof: ProofCheck): ProofOfVisitStatus =>
  proof.checked ? proofStatusForAuthor(proof.decision) : { result: "notChecked" };

const isPending = (proof: ProofCheck | null): proof is CheckedProof =>
  proof?.checked === true && proof.decision.result === "pending";

/**
 * Deletes proof files once the result they belong to is final: the given paths, or
 * (`allBut`) every proof file of the Testimony except a pending one, so a new decision
 * also clears a proof it replaced. Never fails the request: the bucket lifecycle rule
 * is the backstop.
 */
async function deleteProofFiles(
  context: AppLoadContext,
  uploads: Bucket,
  target: { paths: string[] } | { testimonyId: string; allBut?: string },
): Promise<void> {
  try {
    const paths =
      "paths" in target
        ? target.paths
        : (await storedProofPaths(uploads, target.testimonyId)).filter((path) => path !== target.allBut);
    await deleteTestimonyMedia(uploads, paths);
  } catch (error) {
    context.logger.warn("testimony", {
      outcome: "proof_delete_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
  }
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
  const roundsUsed = await authorFixRoundsUsed(firestore, user.uid, value.placeId);
  const media = await storeTestimonyMedia(uploads, ref.id, files.files);
  let status: "published" | "held";
  let verifiedVisit = false;
  const listedName = listedAtStart ? (providerAtStart?.get("name") as string) : undefined;
  const outcome = await moderate(context, gate, {
    value,
    typedProviderName: listedName ?? value.providerName,
    authorFixRound: roundsUsed,
    media,
  });
  const { decision: moderation } = outcome;
  if (moderation.decision === "authorFix") {
    context.logger.info("testimony", { outcome: "author_fix", round: roundsUsed + 1 });
    return authorFixResponse(gate, { placeId: value.placeId, text: value.text, roundsUsed, outcome, media });
  }
  // Decided whatever Moderation said about the text: the proof never holds a Testimony.
  const read = media.proofPath ? await readProof(context, uploads, outcome, media.proofPath) : null;
  // Decided in the transaction below, where the reuse check runs.
  let proof = (read?.checked === false ? read : null) as ProofCheck | null;
  try {
    status = statusForDecision(moderation.decision);
    const location = status === "published" && !listedAtStart ? await coordinatesFor(context, value.placeId) : null;
    const decisionRef = firestore.collection(COLLECTIONS.moderationDecisions).doc();
    const decided = status;
    const decidedOutcome = outcome;

    await firestore.runTransaction(async (tx) => {
      const mine = await tx.get(
        testimonies(firestore).where("authorUid", "==", user.uid).where("placeId", "==", value.placeId),
      );
      const active = mine.docs.find((doc) => doc.get("status") !== "deleted");
      if (active) throw new TestimonyRefusal(409, "already_posted", active.id);
      const provider = await tx.get(providers(firestore).doc(value.placeId));
      const published = decided === "published" ? await tx.get(publishedOf(firestore, value.placeId)) : null;
      if (read?.checked) {
        proof = await decidedProof(tx, firestore, read, {
          testimonyId: ref.id,
          placeId: value.placeId,
          visitMonth: value.visitMonth,
        });
      }

      const now = Timestamp.now();
      verifiedVisit = proof?.checked === true && proof.decision.result === "accepted";
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
          decidedOutcome,
          { subjectType: "testimony", subjectId: ref.id, placeId: value.placeId },
          isSpotCheck(decided === "published", context.config.spotCheckRate),
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
        status: decided,
        verifiedVisit,
        ...(proof?.checked ? { proofOfVisit: proofRecord(proof, 1, now) } : {}),
        consent: { termsVersion: TESTIMONY_TERMS_VERSION, acceptedAt: now },
        authorFixRounds: roundsUsed,
        moderationDecisionId: decisionRef.id,
        createdAt: now,
        updatedAt: now,
        ...(decided === "published" ? { publishedAt: now } : {}),
      };
      tx.create(ref, doc);
      if (proof?.checked) keepFingerprint(tx, firestore, { testimonyId: ref.id, placeId: value.placeId }, proof, now);
      recordTestimonyTransition(firestore, tx, null, { status: decided, verifiedVisit });
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, newPaths(media)).catch(() => {});
    return refusalResponse(request, error);
  }

  if (media.proofPath && !isPending(proof)) await deleteProofFiles(context, uploads, { paths: [media.proofPath] });
  const proofStatus = proof ? proofFeedback(proof) : undefined;
  context.logger.info("testimony", {
    outcome: "created",
    status,
    ...(proofStatus ? { proof: proofStatus.result } : {}),
  });
  const body: TestimonyStoredResponse = {
    testimonyId: ref.id,
    status,
    ...storedFeedback(t, status, outcome, { authorFixRound: roundsUsed }),
    verifiedVisit,
    ...(proofStatus ? { proof: proofStatus } : {}),
  };
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
  // A proof sent with an edit is an attempt too (spec 09): refused before Moderation runs.
  if (files.files.proof && proofAttemptsUsed(current)) {
    return errorResponse(request, 409, "proof_attempts_used", {
      fieldErrors: { proof: t("testimonyApi.fields.proofAttemptsUsed") },
    });
  }

  const roundsUsed = await authorFixRoundsUsed(firestore, user.uid, current.placeId);
  const media = await storeTestimonyMedia(uploads, testimonyId, files.files);
  const editingPublished = current.status === "published";
  const proposedName = value.providerName ?? current.proposedProviderName;
  const typedProviderName = listedAtStart ? (providerAtStart.data() as ProviderDoc).name : proposedName;
  const outcome = await moderate(context, gate, {
    value,
    typedProviderName,
    authorFixRound: roundsUsed,
    keptPhotoPaths: keep,
    media,
  });
  if (outcome.decision.decision === "authorFix") {
    // The Testimony stays exactly as it was until the author sends a fixed edit.
    context.logger.info("testimony", { outcome: "author_fix", round: roundsUsed + 1, revision: editingPublished });
    return authorFixResponse(gate, {
      placeId: current.placeId,
      text: value.text,
      roundsUsed,
      outcome,
      media,
      testimonyId,
    });
  }
  // A held or rejected Testimony waits for an admin (ADR-0004): an edit is screened
  // again but cannot Moderate its way past that, so it stays held for the queue.
  const withAdmin = ADMIN_DECIDES.has(current.status);
  const decided: "published" | "held" = withAdmin ? "held" : statusForDecision(outcome.decision.decision);
  const read = media.proofPath ? await readProof(context, uploads, outcome, media.proofPath) : null;
  let verifiedVisitAfter = current.verifiedVisit;
  let orphaned: string[] = [];
  // The proof result this edit wrote, if any, and what the author reads about it. Both
  // are assigned inside the transaction callback, which control flow analysis cannot see.
  let proofWritten = null as ProofOfVisitRecord | null;
  let proofStatus = undefined as ProofOfVisitStatus | undefined;
  try {
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
      // A proven Testimony keeps its accepted proof; any other proof result is replaced.
      const toDecide = read?.checked && !before.verifiedVisit ? read : null;
      // Another proof was checked meanwhile (attached later) and used the last attempt.
      if (toDecide && proofAttemptsUsed(before)) throw new TestimonyRefusal(409, "proof_attempts_used");
      const newProof = toDecide
        ? await decidedProof(tx, firestore, toDecide, {
            testimonyId,
            placeId: before.placeId,
            visitMonth: value.visitMonth,
          })
        : null;
      const proofAccepted = newProof?.decision.result === "accepted";
      // Accepted while an edit of the published version waits: the public version is proven now.
      const provenWhilePending = editingPublished && status !== "published" && proofAccepted;
      const provider = await tx.get(providers(firestore).doc(before.placeId));
      const publicChanges = becomesPublished || (editingPublished && status === "published") || provenWhilePending;
      const published = publicChanges ? await tx.get(publishedOf(firestore, before.placeId)) : null;

      const now = Timestamp.now();
      const content = contentOf(value, [...keep, ...media.photoPaths]);
      const verifiedVisit = before.verifiedVisit || proofAccepted;
      const proofOfVisit = newProof ? proofRecord(newProof, proofAttempts(before) + 1, now) : null;
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
          ...(proofOfVisit ? { proofOfVisit } : {}),
          updatedAt: now,
        };
        after = { photoPaths: before.photoPaths, pending: content.photoPaths };
        if (provenWhilePending && published) {
          writeProviderOnPublish(tx, {
            placeId: before.placeId,
            provider,
            published,
            testimonyId,
            self: { ...before, verifiedVisit: true },
            proposal: null,
          });
          update.verifiedVisit = true;
          verifiedVisitAfter = true;
          recordTestimonyTransition(
            firestore,
            tx,
            { status: before.status, verifiedVisit: before.verifiedVisit },
            { status: before.status, verifiedVisit: true },
          );
        }
      } else {
        update = {
          ...contentUpdate(content),
          displayName: value.displayName,
          status,
          verifiedVisit,
          ...(proofOfVisit ? { proofOfVisit } : {}),
          moderationDecisionId: decisionRef.id,
          pendingRevision: FieldValue.delete(),
          authorFixRounds: roundsUsed,
          updatedAt: now,
        };
        after = { photoPaths: content.photoPaths, pending: [] };
        verifiedVisitAfter = verifiedVisit;
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
      if (newProof) keepFingerprint(tx, firestore, { testimonyId, placeId: before.placeId }, newProof, now);
      tx.delete(authorFixCounter(firestore, user.uid, before.placeId));
      const kept = new Set([...after.photoPaths, ...after.pending]);
      orphaned = storedPhotoPaths(before).filter((path) => !kept.has(path));
      proofWritten = proofOfVisit;
      if (read) {
        proofStatus = proofOfVisit
          ? proofStatusForAuthor(proofOfVisit)
          : before.verifiedVisit
            ? { result: "accepted" }
            : { result: "notChecked" };
      }
    });
  } catch (error) {
    await deleteTestimonyMedia(uploads, newPaths(media)).catch(() => {});
    return refusalResponse(request, error);
  }

  await deleteTestimonyMedia(uploads, orphaned);
  if (media.proofPath) {
    // A new result also clears the proof it replaced; otherwise only the new file goes.
    await deleteProofFiles(
      context,
      uploads,
      proofWritten
        ? { testimonyId, ...(proofWritten.result === "pending" ? { allBut: media.proofPath } : {}) }
        : { paths: [media.proofPath] },
    );
  }
  context.logger.info("testimony", {
    outcome: "edited",
    status: decided,
    revision: editingPublished,
    ...(proofStatus ? { proof: proofStatus.result } : {}),
  });
  const body: TestimonyStoredResponse = {
    testimonyId,
    status: decided,
    ...storedFeedback(t, decided, outcome, { withAdmin, authorFixRound: roundsUsed }),
    verifiedVisit: verifiedVisitAfter,
    ...(proofStatus ? { proof: proofStatus } : {}),
  };
  return Response.json(body);
}

/** A proof may be attached later only to a published Testimony without an accepted proof, while attempts are left. */
function checkAttachable(testimony: TestimonyDoc): void {
  if (testimony.status !== "published") throw new TestimonyRefusal(409, "proof_not_attachable");
  if (hasAcceptedProof(testimony)) throw new TestimonyRefusal(409, "proof_already_accepted");
  if (proofAttemptsUsed(testimony)) throw new TestimonyRefusal(409, "proof_attempts_used");
}

/**
 * POST /api/testimonies/:testimonyId/proof: the author attaches a Proof of Visit to their
 * published Testimony (spec 09). Moderation runs in proof-only mode: the text and photos
 * are not screened again, nothing waits in `pendingRevision`, no decision is recorded and
 * the public Testimony stays as it is. The submission's proof decision applies; accepted
 * makes it Proven, with aggregates and the impact counter following. Each check is an
 * attempt (3 in all, the one at submission included); a proof the agent could not read
 * is none, and its file goes. Shares the per-account limit of submissions and edits.
 */
export async function attachProof(context: AppLoadContext, request: Request, testimonyId: string) {
  const gate = await gateSubmission(context, request);
  if (gate instanceof Response) return gate;
  const { firestore, uploads, user, language, t } = gate;

  let current: TestimonyDoc;
  try {
    ({ testimony: current } = await ownTestimony(firestore, testimonyId, user.uid));
    checkAttachable(current);
  } catch (error) {
    return refusalResponse(request, error);
  }

  const formData = await readForm(request);
  const file = formData ? await readProofFile(formData, { language }) : null;
  if (!file?.ok || !file.proof) {
    const fieldErrors = file && !file.ok ? file.fieldErrors : { proof: t("testimonyApi.fields.proofMissing") };
    return errorResponse(request, 400, "invalid_file", { fieldErrors });
  }

  const listedProvider = await providers(firestore).doc(current.placeId).get();
  const { proofPath } = await storeTestimonyMedia(uploads, testimonyId, { photos: [], proof: file.proof });
  if (!proofPath) throw new Error("the proof was not stored");
  const extraction = await checkProofOnly(context, {
    placeId: current.placeId,
    language,
    ...(listedProvider.exists ? { typedProviderName: (listedProvider.data() as ProviderDoc).name } : {}),
    proofPath,
  });
  const read = extraction ? await fingerprinted(context, uploads, extraction, proofPath) : null;
  if (!read?.checked) {
    // Not checked, so no attempt: the author may simply send it again later.
    await deleteProofFiles(context, uploads, { paths: [proofPath] });
    context.logger.info("testimony", { outcome: "proof_attached", proof: "notChecked" });
    return errorResponse(request, 503, "proof_check_unavailable");
  }

  const ref = testimonies(firestore).doc(testimonyId);
  let after: TestimonyDoc;
  let proof: CheckedProof;
  try {
    ({ after, proof } = await firestore.runTransaction(async (tx) => {
      const before = checkOwn(await tx.get(ref), user.uid);
      // Moved meanwhile (hidden after a report, another proof decided): ask again.
      checkAttachable(before);
      const proof = await decidedProof(tx, firestore, read, {
        testimonyId,
        placeId: before.placeId,
        visitMonth: before.visitMonth,
      });
      const accepted = proof.decision.result === "accepted";
      const provider = accepted ? await tx.get(providers(firestore).doc(before.placeId)) : null;
      const published = accepted ? await tx.get(publishedOf(firestore, before.placeId)) : null;

      const now = Timestamp.now();
      const proofOfVisit = proofRecord(proof, proofAttempts(before) + 1, now);
      const update: Record<string, unknown> = { proofOfVisit, updatedAt: now };
      if (provider && published) {
        // The public version is Proven now; a pending edit of it changes nothing here.
        writeProviderOnPublish(tx, {
          placeId: before.placeId,
          provider,
          published,
          testimonyId,
          self: { ...before, verifiedVisit: true },
          proposal: null,
        });
        update.verifiedVisit = true;
        recordTestimonyTransition(
          firestore,
          tx,
          { status: before.status, verifiedVisit: before.verifiedVisit },
          { status: before.status, verifiedVisit: true },
        );
      }
      tx.update(ref, update);
      keepFingerprint(tx, firestore, { testimonyId, placeId: before.placeId }, proof, now);
      return { after: { ...before, proofOfVisit, verifiedVisit: accepted }, proof };
    }));
  } catch (error) {
    await deleteProofFiles(context, uploads, { paths: [proofPath] });
    return refusalResponse(request, error);
  }

  const result = proof.decision.result;
  // The new result also clears a proof it replaced; a pending one stays for the team.
  await deleteProofFiles(context, uploads, { testimonyId, ...(result === "pending" ? { allBut: proofPath } : {}) });
  context.logger.info("testimony", { outcome: "proof_attached", proof: result });
  const body: ProofAttachResponse = {
    testimonyId,
    verifiedVisit: after.verifiedVisit,
    proof: proofStatusForAuthor(proof.decision),
    attemptsLeft: proofAttemptsLeft(after),
  };
  return Response.json(body);
}

/**
 * DELETE /api/testimonies/:testimonyId: the author erases their Testimony from any
 * state. Text, photos (and their stored objects), the Proof of Visit record, its
 * fingerprint and any waiting file, a pending edit and any reply go; aggregates and
 * counters are recomputed when it was published. Not rate limited (erasure must always
 * work), but needs App Check like every write.
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
        // The proof record goes too: the facts read from it and any admin note. Only
        // `verifiedVisit` stays, a yes or no that the counters above already settled.
        proofOfVisit: FieldValue.delete(),
      });
      // Erasure takes the Proof Fingerprint too, which frees the receipt.
      tx.delete(fingerprintRef(firestore, testimonyId));
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
  // A proof still waiting for an admin goes with the Testimony.
  await deleteProofFiles(context, uploads, { testimonyId });
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
  /** Where the Proof of Visit stands, when one was checked (spec 09). */
  proof?: ProofOfVisitStatus;
  /**
   * Published without an accepted proof, so a Proof of Visit may be attached: the proofs
   * the author may still send (0 when all 3 were checked). Absent otherwise.
   */
  proofAttemptsLeft?: number;
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
      ...(testimony.proofOfVisit ? { proof: proofStatusForAuthor(testimony.proofOfVisit) } : {}),
      ...(testimony.status === "published" && !hasAcceptedProof(testimony)
        ? { proofAttemptsLeft: proofAttemptsLeft(testimony) }
        : {}),
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
