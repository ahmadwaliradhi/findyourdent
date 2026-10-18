// The Moderation step of posting (spec 03): the agent service's Moderation endpoint,
// called with the Testimony, Google's live name (in memory only, for R6 and the Proof
// of Visit match), the stored EXIF-stripped photos and the private Proof of Visit, whose
// printed facts come back for the web service's own proof decision (spec 09).
// Whatever goes wrong (agent error, a 422 for a broken attachment, a timeout, an
// answer that does not validate) becomes `hold` with `model_error`: never publish on
// an answer we could not trust.
import {
  formatValidationErrors,
  type ModerationDecision,
  type ModerationRequest,
  type ModerationRuleCode,
  type ProofCheckRequest,
  type ProofExtraction,
  validateModerationDecision,
  validateModerationRequest,
  validateProofCheckRequest,
  validateProofCheckResponse,
} from "@findyourdent/contracts";
import type { ModerationDecisionDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { TFunction } from "i18next";
import type { AppLoadContext } from "react-router";
import { getI18n, type Language } from "~/i18n/config";
import { AUTHOR_FIXABLE_RULES, MAX_AUTHOR_FIX_ROUNDS } from "~/lib/testimony";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import type { Bucket } from "../../server/firebase.ts";
import { isPdfProof } from "../../server/proof-files.ts";

/**
 * Model recorded on decisions the agent made: its configured default
 * (services/agent config.py, MODERATION_MODEL).
 */
export const MODERATION_MODEL = "gemini-3.5-flash-lite";
/** Model name recorded when the call failed or its answer was unusable, and the content was held instead. */
export const FALLBACK_MODEL = "fallback";

export interface ModerationInput {
  placeId: string;
  /** Google's place name lookup and the author-facing message use this language. */
  language: Language;
  text: string;
  typedProviderName?: string;
  procedureCode?: string;
  visitMonth: string;
  /** authorFix rounds this content has had already. */
  authorFixRound: number;
  /** Stored, EXIF-stripped photo object paths (the uploads bucket), for the photo rules. */
  photoPaths: readonly string[];
  /** Stored private Proof of Visit; the caller deletes it once the proof is decided (spec 09). */
  proofPath?: string;
}

export interface ModerationOutcome {
  decision: ModerationDecision;
  /** MODERATION_MODEL, or FALLBACK_MODEL when the result was unusable. */
  model: string;
}

/** Google's live name, in memory only. Without it Moderation runs on the typed name alone. */
async function googleDisplayName(
  context: AppLoadContext,
  input: Pick<ModerationInput, "placeId" | "language">,
): Promise<string | undefined> {
  const result = await context.adapters.places.getDisplayName({ placeId: input.placeId, language: input.language });
  if (result.ok) return result.displayName;
  context.logger.warn("moderation", { outcome: "google_name_unavailable", reason: result.reason });
  return undefined;
}

async function base64Of(uploads: Bucket, path: string): Promise<string> {
  const [bytes] = await uploads.file(path).download();
  return bytes.toString("base64");
}

/** A stored Proof of Visit as the agent takes it: JPEG (images, EXIF stripped) or PDF as sent (testimony-media.server.ts). */
async function proofOfVisitFile(uploads: Bucket, proofPath: string): Promise<ProofCheckRequest["proofOfVisit"]> {
  return {
    mimeType: isPdfProof(proofPath) ? "application/pdf" : "image/jpeg",
    dataBase64: await base64Of(uploads, proofPath),
  };
}

/** The request the agent's Moderation endpoint takes; star ratings deliberately left out. */
async function buildRequest(context: AppLoadContext, input: ModerationInput): Promise<ModerationRequest> {
  const { uploads } = context;
  if (!uploads) throw new Error("uploads bucket not configured");
  const [googleName, photos, proof] = await Promise.all([
    googleDisplayName(context, input),
    Promise.all(
      input.photoPaths.map(async (path) => ({
        mimeType: "image/jpeg" as const,
        dataBase64: await base64Of(uploads, path),
      })),
    ),
    input.proofPath ? proofOfVisitFile(uploads, input.proofPath) : undefined,
  ]);
  const request: ModerationRequest = {
    subjectType: "testimony",
    language: input.language,
    text: input.text,
    visitMonth: input.visitMonth,
    authorFixRound: input.authorFixRound,
    ...(input.typedProviderName ? { typedProviderName: input.typedProviderName } : {}),
    ...(googleName ? { googleDisplayName: googleName } : {}),
    ...(input.procedureCode ? { procedureCode: input.procedureCode } : {}),
    ...(photos.length > 0 ? { photos } : {}),
    ...(proof ? { proofOfVisit: proof } : {}),
  };
  if (!validateModerationRequest(request)) {
    throw new Error(`invalid moderation request: ${formatValidationErrors(validateModerationRequest.errors)}`);
  }
  return request;
}

function modelErrorHold(t: TFunction): ModerationOutcome {
  return {
    decision: {
      decision: "hold",
      ruleCodes: ["model_error"],
      flaggedSpans: [],
      confidence: 0,
      authorMessage: t("testimonyApi.moderation.held"),
    },
    model: FALLBACK_MODEL,
  };
}

/**
 * Screens one Testimony (or an edit of one) and reads its Proof of Visit. Never throws:
 * anything that fails or does not validate becomes `hold` with `model_error`, and then
 * `proofExtraction` is absent: the proof was not checked. An authorFix past the third
 * round is held here even if the agent did not hold it.
 */
export async function moderateTestimony(context: AppLoadContext, input: ModerationInput): Promise<ModerationOutcome> {
  const t = getI18n(input.language).getFixedT(input.language);
  let body: unknown;
  try {
    const request = await buildRequest(context, input);
    body = await context.adapters.agent.requestModeration(request, { requestId: context.requestId });
  } catch (error) {
    context.logger.error("moderation", {
      outcome: "agent_failed",
      error: error instanceof Error ? error.name : "unknown",
      ...(error instanceof Error && "status" in error && typeof error.status === "number"
        ? { status: error.status }
        : {}),
    });
    return modelErrorHold(t);
  }
  if (!validateModerationDecision(body)) {
    context.logger.error("moderation", {
      outcome: "invalid_decision",
      errors: formatValidationErrors(validateModerationDecision.errors),
    });
    return modelErrorHold(t);
  }
  const decision = body;
  if (decision.decision === "authorFix" && input.authorFixRound >= MAX_AUTHOR_FIX_ROUNDS) {
    return {
      decision: { ...decision, decision: "hold", authorMessage: t("testimonyApi.moderation.held") },
      model: MODERATION_MODEL,
    };
  }
  return { decision, model: MODERATION_MODEL };
}

export interface ProofCheckInput {
  placeId: string;
  /** Google's place name lookup uses this language. */
  language: Language;
  /** The Listed Provider's name, which the proof is matched against with Google's. */
  typedProviderName?: string;
  /** The stored Proof of Visit; the caller deletes it once decided (spec 09). */
  proofPath: string;
}

/**
 * Moderation in proof-only mode (spec 09): reads the facts printed on a Proof of Visit
 * attached to a published Testimony. Only the proof and the Provider's names go to the
 * agent: no text, no photos, so nothing is screened again and there is no decision.
 * Never throws: null when the agent failed or its answer does not validate, and then
 * the proof was not checked.
 */
export async function checkProofOnly(context: AppLoadContext, input: ProofCheckInput): Promise<ProofExtraction | null> {
  let body: unknown;
  try {
    const { uploads } = context;
    if (!uploads) throw new Error("uploads bucket not configured");
    const [googleName, proofOfVisit] = await Promise.all([
      googleDisplayName(context, input),
      proofOfVisitFile(uploads, input.proofPath),
    ]);
    const request: ProofCheckRequest = {
      ...(input.typedProviderName ? { typedProviderName: input.typedProviderName } : {}),
      ...(googleName ? { googleDisplayName: googleName } : {}),
      proofOfVisit,
    };
    if (!validateProofCheckRequest(request)) {
      throw new Error(`invalid proof check request: ${formatValidationErrors(validateProofCheckRequest.errors)}`);
    }
    body = await context.adapters.agent.requestProofCheck(request, { requestId: context.requestId });
  } catch (error) {
    context.logger.error("proof_check", {
      outcome: "agent_failed",
      error: error instanceof Error ? error.name : "unknown",
      ...(error instanceof AgentUnavailableError && error.status ? { status: error.status } : {}),
      ...(error instanceof AgentUnavailableError && error.code ? { code: error.code } : {}),
    });
    return null;
  }
  if (!validateProofCheckResponse(body)) {
    context.logger.error("proof_check", {
      outcome: "invalid_response",
      errors: formatValidationErrors(validateProofCheckResponse.errors),
    });
    return null;
  }
  return body.proofExtraction;
}

/** The status a stored decision leads to; an authorFix is never stored. */
export function statusForDecision(decision: "publish" | "hold"): "published" | "held" {
  return decision === "publish" ? "published" : "held";
}

type HoldReason =
  | "accusation"
  | "namedPerson"
  | "harassment"
  | "conflictOfInterest"
  | "othersHealthData"
  | "manipulation"
  | "photo"
  | "fixRoundsUsed"
  | "needsCheck"
  | "unsure"
  | "checkFailed"
  | "withAdmin";

/** Plain reasons for a hold, one per kind of rule that fired, in this order. */
const HOLD_REASONS: ReadonlyArray<[reason: HoldReason, codes: readonly ModerationRuleCode[]]> = [
  ["accusation", ["r2_accusation_as_fact"]],
  ["namedPerson", ["named_person_negative"]],
  ["harassment", ["r3_hate_or_harassment"]],
  ["conflictOfInterest", ["r7_conflict_of_interest"]],
  ["othersHealthData", ["r8_third_party_health_data"]],
  ["manipulation", ["r9_manipulation"]],
  ["photo", ["photo_not_clinic_setting"]],
  // Fixable rules reach a hold after the fix rounds, or beside a hold rule, or when the
  // model named a rule it could not point at in the text.
  ["fixRoundsUsed", AUTHOR_FIXABLE_RULES],
  ["unsure", ["low_confidence", "promotional_wording", "misleading_statement"]],
  ["checkFailed", ["model_error"]],
];

/**
 * What a held author reads: the plain reason (why the team looks at it) and the
 * 24-hour target. `withAdmin`: an edit of a held or rejected Testimony, which goes
 * back to the team whatever Moderation said. `authorFixRound`: the rounds this
 * content had, so a fixable rule only says "after three rounds" when it is true.
 */
export function holdMessage(
  t: TFunction,
  ruleCodes: readonly ModerationRuleCode[],
  options: { withAdmin?: boolean; authorFixRound: number },
): string {
  const reasons: HoldReason[] = options.withAdmin
    ? ["withAdmin"]
    : HOLD_REASONS.filter(([, codes]) => codes.some((code) => ruleCodes.includes(code))).map(([reason]) =>
        reason === "fixRoundsUsed" && options.authorFixRound < MAX_AUTHOR_FIX_ROUNDS ? "needsCheck" : reason,
      );
  const shown: HoldReason[] = reasons.length > 0 ? reasons : ["unsure"];
  const sentences = shown.map((reason) => t(`testimonyApi.moderation.holdReasons.${reason}`));
  return [...sentences, t("testimonyApi.moderation.holdTarget")].join(" ");
}

/**
 * Whether this decision joins the spot-check sample. Only Testimonies Moderation
 * actually published are sampled: a "publish" decision on content that stays with
 * the admin (an edit of a held or rejected Testimony) is not.
 */
export function isSpotCheck(autoPublished: boolean, rate: number, random: () => number = Math.random): boolean {
  return autoPublished && random() < rate;
}

/** The stored record of a decision; never the moderated text or images. */
export function moderationDecisionDoc(
  outcome: ModerationOutcome,
  subject: { subjectType: "testimony" | "testimonyRevision"; subjectId: string; placeId: string },
  spotCheck: boolean,
): ModerationDecisionDoc {
  const { decision } = outcome;
  return {
    ...subject,
    decision: decision.decision,
    ruleCodes: decision.ruleCodes,
    flaggedSpans: decision.flaggedSpans,
    ...(decision.flaggedPhotos ? { flaggedPhotos: decision.flaggedPhotos } : {}),
    confidence: decision.confidence,
    // The Proof of Visit facts are not a Moderation result: they are kept on the
    // Testimony with its proof decision (spec 09), never here.
    model: outcome.model,
    spotCheck,
    // Written only on sampled decisions, so the queue finds open ones with two equality filters.
    ...(spotCheck ? { spotCheckConfirmed: false } : {}),
    decidedAt: Timestamp.now(),
  };
}
