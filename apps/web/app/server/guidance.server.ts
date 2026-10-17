import {
  type GuidanceRequest,
  type GuidanceResponse,
  validateGuidanceRequest,
  validateGuidanceResponse,
} from "@findyourdent/contracts";
import type { AppLoadContext } from "react-router";
import type { Language } from "~/i18n/config";

export type GuidanceErrorCode = "invalid_request" | "agent_unavailable" | "invalid_agent_response";

export type GuidanceOutcome =
  | { ok: true; response: GuidanceResponse }
  | { ok: false; status: 400 | 502; error: GuidanceErrorCode };

export interface GuidanceInput {
  sessionId: string;
  language: Language | unknown;
  complaintText?: unknown;
  followUpAnswer?: unknown;
}

function text(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * One Patient turn: build a GuidanceRequest, validate it against the contract,
 * call the agent through its adapter, validate what comes back. Complaint text
 * stays in memory; logs carry outcome codes only.
 */
export async function requestGuidance(context: AppLoadContext, input: GuidanceInput): Promise<GuidanceOutcome> {
  const candidate: Record<string, unknown> = { sessionId: input.sessionId, language: input.language };
  const complaintText = text(input.complaintText);
  const followUpAnswer = text(input.followUpAnswer);
  if (complaintText !== undefined) candidate.complaintText = complaintText;
  if (followUpAnswer !== undefined) candidate.followUpAnswer = followUpAnswer;

  if (!validateGuidanceRequest(candidate)) {
    context.logger.warn("guidance", { outcome: "invalid_request" });
    return { ok: false, status: 400, error: "invalid_request" };
  }
  const request: GuidanceRequest = candidate;

  let raw: unknown;
  try {
    raw = await context.adapters.agent.requestGuidance(request, { requestId: context.requestId });
  } catch (error) {
    context.logger.error("guidance", {
      outcome: "agent_unavailable",
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, status: 502, error: "agent_unavailable" };
  }

  if (!validateGuidanceResponse(raw)) {
    context.logger.error("guidance", { outcome: "invalid_agent_response" });
    return { ok: false, status: 502, error: "invalid_agent_response" };
  }
  context.logger.info("guidance", { outcome: "ok", kind: raw.kind });
  return { ok: true, response: raw };
}
