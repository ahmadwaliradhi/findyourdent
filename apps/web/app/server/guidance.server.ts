import {
  type GuidanceRequest,
  type GuidanceResponse,
  validateGuidanceRequest,
  validateGuidanceResponse,
} from "@findyourdent/contracts";
import type { AppLoadContext } from "react-router";
import type { Language } from "~/i18n/config";
import { recordGuidanceSessionCompleted } from "~/server/impact.server";

export type GuidanceErrorCode =
  | "invalid_request"
  | "audio_too_large"
  | "no_speech"
  | "agent_unavailable"
  | "invalid_agent_response";

export type GuidanceOutcome =
  | { ok: true; response: GuidanceResponse }
  | { ok: false; status: 400 | 413 | 422 | 502; error: GuidanceErrorCode };

export interface GuidanceInput {
  sessionId: string;
  language: Language | unknown;
  complaintText?: unknown;
  /** A recorded voice note (a Blob from the form), or { mimeType, dataBase64 } from the JSON API. */
  audio?: unknown;
  followUpQuestion?: unknown;
  followUpAnswer?: unknown;
}

/**
 * Largest voice note the agent accepts: dataBase64's maxLength in
 * guidance-request.schema.json (2,800,000 characters) decoded to bytes.
 */
export const VOICE_NOTE_MAX_BYTES = 2_100_000;

/**
 * True when the declared body is far bigger than any Guidance form, so the action
 * refuses it before buffering it. A voice note just over the cap is read and refused
 * by its size instead, which leaves the connection usable.
 */
export function guidanceBodyTooLarge(request: Request): boolean {
  const length = Number(request.headers.get("content-length") ?? 0);
  return length > 2 * VOICE_NOTE_MAX_BYTES;
}

/** A recorded Blob as the contract's audio object; anything else passes on for the validator. */
async function voiceNote(value: unknown): Promise<unknown> {
  if (!(value instanceof Blob)) return value ?? undefined;
  if (value.size === 0) return undefined;
  // "audio/webm;codecs=opus" from MediaRecorder: the contract lists bare types.
  const mimeType = value.type.split(";")[0]?.trim().toLowerCase();
  return { mimeType, dataBase64: Buffer.from(await value.arrayBuffer()).toString("base64") };
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
  const followUpQuestion = text(input.followUpQuestion);
  const followUpAnswer = text(input.followUpAnswer);
  if (complaintText !== undefined) candidate.complaintText = complaintText;
  // Typed text wins: a corrected transcript comes back as text with the old recording dropped.
  else if (input.audio instanceof Blob && input.audio.size > VOICE_NOTE_MAX_BYTES) {
    context.logger.warn("guidance", { outcome: "audio_too_large" });
    return { ok: false, status: 413, error: "audio_too_large" };
  } else {
    const audio = await voiceNote(input.audio);
    if (audio !== undefined) candidate.audio = audio;
  }
  if (followUpQuestion !== undefined) candidate.followUpQuestion = followUpQuestion;
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
    // AgentUnavailableError.code; matched by value, not class, across module graphs.
    if (error instanceof Error && "code" in error && error.code === "no_speech") {
      context.logger.info("guidance", { outcome: "no_speech" });
      return { ok: false, status: 422, error: "no_speech" };
    }
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
  if (raw.kind !== "followUp") await countCompletedSession(context);
  return { ok: true, response: raw };
}

/**
 * A Guidance card or an Emergency Escalation ends the session: bump the impact
 * counter and nothing else. A counter failure never costs the Patient their answer.
 */
async function countCompletedSession(context: AppLoadContext): Promise<void> {
  if (!context.firestore) return;
  try {
    await recordGuidanceSessionCompleted(context.firestore);
  } catch (error) {
    context.logger.warn("impactCounter", {
      outcome: "increment_failed",
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}
