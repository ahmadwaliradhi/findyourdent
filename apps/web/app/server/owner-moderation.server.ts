// Moderation of what a claimed Provider writes (spec 05): owner facts with the
// Provider-facts rule set, replies with the Testimony rules plus promotional wording.
// Unlike a Testimony there is no fix-before-submit loop: any rule hit holds the
// content for an admin, and so does anything the agent could not decide.
import {
  formatValidationErrors,
  type ModerationDecision,
  type ModerationRequest,
  validateModerationDecision,
  validateModerationRequest,
} from "@findyourdent/contracts";
import type { ModerationDecisionDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import type { Language } from "~/i18n/config";
import { procedureLabel } from "~/lib/procedures";
import { regionLabel } from "~/lib/regions";
import type { OwnerFactsValues } from "./claims.server.ts";
import { FALLBACK_MODEL } from "./testimony-moderation.server.ts";

/** The agent's Moderation model; its response does not name the model it used. */
export const AGENT_MODERATION_MODEL = "gemini-3.5-flash-lite";

export interface OwnerModerationOutcome {
  /** Only publish or hold: an authorFix from the agent is a hold here. */
  decision: ModerationDecision & { decision: "publish" | "hold" };
  model: string;
}

/** Owner facts flattened to one text, one labelled line per fact, in the owner's language. */
export function flattenOwnerFacts(facts: OwnerFactsValues, language: Language): string {
  const en = language === "en";
  const lines: Array<[string, string | undefined]> = [
    [en ? "Name" : "Nama", facts.name],
    [en ? "Type" : "Jenis", facts.providerType],
    [en ? "Region" : "Wilayah", regionLabel(facts.region)],
    [en ? "Address" : "Alamat", facts.address],
    [en ? "Phone" : "Telepon", facts.phone],
    ["WhatsApp", facts.whatsapp],
    [en ? "Opening hours" : "Jam buka", facts.openingHours],
    [en ? "Services" : "Layanan", facts.services.map((code) => procedureLabel(code, language)).join(", ") || undefined],
  ];
  return lines
    .filter((line): line is [string, string] => Boolean(line[1]))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function heldOnError(): OwnerModerationOutcome {
  return {
    decision: { decision: "hold", ruleCodes: ["model_error"], flaggedSpans: [], confidence: 0, authorMessage: "held" },
    model: FALLBACK_MODEL,
  };
}

/** Screens owner facts or a reply. Never throws: an agent failure or an invalid answer holds. */
export async function moderateOwnerContent(
  context: AppLoadContext,
  request: ModerationRequest,
): Promise<OwnerModerationOutcome> {
  if (!validateModerationRequest(request)) {
    throw new Error(`invalid moderation request: ${formatValidationErrors(validateModerationRequest.errors)}`);
  }
  let body: unknown;
  try {
    body = await context.adapters.agent.requestModeration(request, { requestId: context.requestId });
  } catch (error) {
    context.logger.warn("owner_moderation", {
      outcome: "agent_unavailable",
      subjectType: request.subjectType,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return heldOnError();
  }
  if (!validateModerationDecision(body)) {
    context.logger.error("owner_moderation", {
      outcome: "invalid_decision",
      subjectType: request.subjectType,
      errors: formatValidationErrors(validateModerationDecision.errors),
    });
    return heldOnError();
  }
  const decision = body.decision === "publish" ? "publish" : "hold";
  context.logger.info("owner_moderation", { outcome: decision, subjectType: request.subjectType });
  return { decision: { ...body, decision }, model: AGENT_MODERATION_MODEL };
}

/** The stored record of a decision; never the moderated text. */
export function ownerDecisionDoc(
  outcome: OwnerModerationOutcome,
  subject: { subjectType: "reply" | "providerFacts"; subjectId: string; placeId: string },
): ModerationDecisionDoc {
  const { decision } = outcome;
  return {
    ...subject,
    decision: decision.decision,
    ruleCodes: decision.ruleCodes,
    flaggedSpans: decision.flaggedSpans,
    confidence: decision.confidence,
    model: outcome.model,
    spotCheck: false,
    decidedAt: Timestamp.now(),
  };
}
