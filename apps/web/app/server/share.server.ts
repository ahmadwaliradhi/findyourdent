import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { type Guidance, validateGuidanceResponse } from "@findyourdent/contracts";

/**
 * Shareable Guidance link (spec 01): the Guidance object alone, compressed and signed,
 * so the link carries no complaint text and nobody can put their own words on a
 * FindYourDent card. Nothing is stored; the token is the whole card.
 */
const MAC_BYTES = 16;
const MAX_GUIDANCE_BYTES = 64 * 1024;

function mac(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest().subarray(0, MAC_BYTES);
}

export function shareToken(guidance: Guidance, secret: string): string {
  const payload = deflateRawSync(Buffer.from(JSON.stringify(guidance))).toString("base64url");
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The Guidance in a share token, or null if it was altered or is not a valid Guidance. */
export function readShareToken(token: string, secret: string): Guidance | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let guidance: unknown;
  try {
    const json = inflateRawSync(Buffer.from(payload, "base64url"), { maxOutputLength: MAX_GUIDANCE_BYTES });
    guidance = JSON.parse(json.toString("utf8"));
  } catch {
    return null;
  }
  const card = { kind: "guidance", guidance };
  return validateGuidanceResponse(card) && card.kind === "guidance" ? card.guidance : null;
}

export function sharePath(guidance: Guidance, secret: string): string {
  return `/panduan/${shareToken(guidance, secret)}`;
}
