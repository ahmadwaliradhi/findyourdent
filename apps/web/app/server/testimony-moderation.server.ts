// The Moderation seam of posting (spec 03). Until T13 wires the agent's Moderation
// endpoint in, `moderateTestimony` answers from the TESTIMONY_MODERATION switch.
// T13 replaces the body of `moderateTestimony` only: callers already pass a
// schema-valid ModerationRequest plus the stored photo and Proof of Visit paths,
// and act on a schema-valid ModerationDecision.
import {
  formatValidationErrors,
  type ModerationDecision,
  type ModerationRequest,
  validateModerationDecision,
  validateModerationRequest,
} from "@findyourdent/contracts";
import type { ModerationDecisionDoc, TestimonyStatus } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n, type Language } from "~/i18n/config";

/** Model name recorded for decisions made by the temporary switch. */
export const SWITCH_MODEL = "switch";
/** Model name recorded when the decision was invalid and the content was held instead. */
export const FALLBACK_MODEL = "fallback";

export interface ModerationInput {
  request: ModerationRequest;
  /** Stored, EXIF-stripped photo object paths (the uploads bucket), for the photo rules. */
  photoPaths: readonly string[];
  /** Stored private Proof of Visit, deleted by the caller right after this call. */
  proofPath?: string;
}

export interface ModerationOutcome {
  decision: ModerationDecision;
  /** Model id, `switch` before T13, or `fallback` when the result was unusable. */
  model: string;
}

/** The request the agent's Moderation endpoint takes; star ratings deliberately left out. */
export function buildModerationRequest(input: {
  language: Language;
  text: string;
  typedProviderName?: string;
  procedureCode?: string;
  visitMonth: string;
  authorFixRound: number;
}): ModerationRequest {
  const request: ModerationRequest = {
    subjectType: "testimony",
    language: input.language,
    text: input.text,
    visitMonth: input.visitMonth,
    authorFixRound: input.authorFixRound,
    ...(input.typedProviderName ? { typedProviderName: input.typedProviderName } : {}),
    ...(input.procedureCode ? { procedureCode: input.procedureCode } : {}),
  };
  if (!validateModerationRequest(request)) {
    throw new Error(`invalid moderation request: ${formatValidationErrors(validateModerationRequest.errors)}`);
  }
  return request;
}

/**
 * Screens one Testimony (or an edit of one). Never throws for a bad result: anything
 * that does not validate becomes `hold` with `model_error`, as the contract requires.
 *
 * Temporary switch (T11): "publish" publishes everything, "hold" holds everything with
 * `low_confidence` (no model looked at it, so there is no confidence to publish on).
 * No Proof of Visit check runs, so `proofOfVisit` is absent: not verified.
 */
export async function moderateTestimony(context: AppLoadContext, input: ModerationInput): Promise<ModerationOutcome> {
  const t = getI18n(input.request.language).getFixedT(input.request.language);
  const decision: ModerationDecision =
    context.config.testimonyModeration === "publish"
      ? {
          decision: "publish",
          ruleCodes: [],
          flaggedSpans: [],
          confidence: 1,
          authorMessage: t("testimonyApi.moderation.published"),
        }
      : {
          decision: "hold",
          ruleCodes: ["low_confidence"],
          flaggedSpans: [],
          confidence: 0,
          authorMessage: t("testimonyApi.moderation.held"),
        };
  if (validateModerationDecision(decision)) return { decision, model: SWITCH_MODEL };

  context.logger.error("moderation", {
    outcome: "invalid_decision",
    errors: formatValidationErrors(validateModerationDecision.errors),
  });
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

/** The Testimony (or pending revision) status a decision leads to. */
export function statusForDecision(
  decision: ModerationDecision["decision"],
): Extract<TestimonyStatus, "published" | "needsAuthorFix" | "held"> {
  if (decision === "publish") return "published";
  if (decision === "authorFix") return "needsAuthorFix";
  return "held";
}

/** The stored record of a decision; never the moderated text or images. */
export function moderationDecisionDoc(
  outcome: ModerationOutcome,
  subject: { subjectType: "testimony" | "testimonyRevision"; subjectId: string; placeId: string },
): ModerationDecisionDoc {
  const { decision } = outcome;
  return {
    ...subject,
    decision: decision.decision,
    ruleCodes: decision.ruleCodes,
    flaggedSpans: decision.flaggedSpans,
    ...(decision.flaggedPhotos ? { flaggedPhotos: decision.flaggedPhotos } : {}),
    confidence: decision.confidence,
    ...(decision.proofOfVisit ? { proofOfVisit: decision.proofOfVisit } : {}),
    model: outcome.model,
    // The 10% spot-check sample of auto-published Testimonies arrives with T13/T14.
    spotCheck: false,
    decidedAt: Timestamp.now(),
  };
}
