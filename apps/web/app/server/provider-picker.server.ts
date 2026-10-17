import {
  COLLECTIONS,
  type NameCorrectionDoc,
  type ProviderDoc,
  type RegionRef,
} from "@findyourdent/contracts/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { isValidRegion } from "~/lib/regions";
import {
  AUTOCOMPLETE_MIN_CHARS,
  type AutocompleteResponse,
  type ProviderListingResponse,
  TESTIMONY_LIMITS,
} from "~/lib/testimony";
import { readSession } from "../../server/auth.ts";
import { protectionRefusalResponse, protectPaidRequest } from "./protection.server.ts";
import { isPlaceId } from "./provider.server.ts";
import { getOrCreateSessionId } from "./session.server.ts";

/**
 * The Testimony form's Provider part (spec 03, ADR-0005): the Autocomplete picker,
 * whether the picked place is already a Listed Provider, and "Sarankan koreksi".
 * Google's suggestion text is passed through to the picker list only: never stored,
 * never logged, and the typed input is never logged either.
 */

/** Autocomplete session tokens are opaque; the browser sends a UUID. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
/** Longer than any place name; a cap so a pasted essay never reaches Google. */
const AUTOCOMPLETE_MAX_CHARS = 120;
/** A shared location biases suggestions to roughly one city around the Patient. */
export const PICKER_BIAS_RADIUS_METERS = 20_000;
/** Per signed-in account: enough for honest corrections, too few for spam. */
const NAME_CORRECTIONS_PER_DAY = 10;

const NO_STORE = "no-store";

function parseCoordinate(value: string | null, max: number): number | null | undefined {
  if (value === null) return undefined;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && Math.abs(number) <= max ? number : null;
}

/**
 * GET /api/places/autocomplete?input=&sessionToken=[&lat=&lng=]. App Check and the
 * Places rate limits first, so a refused request never reaches the adapter.
 */
export async function autocompleteResponse(context: AppLoadContext, request: Request): Promise<Response> {
  const { sessionId, setCookie } = await getOrCreateSessionId(request);
  const protection = await protectPaidRequest(context, { request, route: "places", sessionId });
  if (!protection.ok) return protectionRefusalResponse(request, protection);

  const headers = new Headers({ "Cache-Control": NO_STORE });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  const invalid = () => Response.json({ error: "invalid_request" }, { status: 400, headers });

  const params = new URL(request.url).searchParams;
  const input = (params.get("input") ?? "").trim();
  const sessionToken = params.get("sessionToken") ?? "";
  if (input.length < AUTOCOMPLETE_MIN_CHARS || input.length > AUTOCOMPLETE_MAX_CHARS) return invalid();
  if (!SESSION_TOKEN.test(sessionToken)) return invalid();
  const lat = parseCoordinate(params.get("lat"), 90);
  const lng = parseCoordinate(params.get("lng"), 180);
  // Both or neither: half a location is a broken client, not a bias.
  if (lat === null || lng === null || (lat === undefined) !== (lng === undefined)) return invalid();

  const result = await context.adapters.places.autocomplete({
    input,
    sessionToken,
    language: await detectLanguage(request),
    ...(lat !== undefined && lng !== undefined
      ? { locationBias: { center: { lat, lng }, radiusMeters: PICKER_BIAS_RADIUS_METERS } }
      : {}),
  });
  context.logger.info("provider_picker_autocomplete", {
    outcome: result.ok ? "ok" : result.reason,
    biased: lat !== undefined,
    ...(result.ok ? { suggestions: result.suggestions.length } : {}),
  });
  const body: AutocompleteResponse = result.ok
    ? { suggestions: result.suggestions }
    : { suggestions: [], unavailable: true };
  return Response.json(body, { headers });
}

async function readProvider(context: AppLoadContext, placeId: string): Promise<ProviderDoc | null> {
  if (!context.firestore) return null;
  const doc = await context.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return doc.exists ? (doc.data() as ProviderDoc) : null;
}

/**
 * GET /api/providers/:placeId/listing. A free Firestore read, no Places call, so no
 * App Check gate (like /api/feed). Only the first-party name and Region go out.
 */
export async function listingResponse(context: AppLoadContext, placeId: string | undefined): Promise<Response> {
  const headers = { "Cache-Control": NO_STORE };
  if (!isPlaceId(placeId)) return Response.json({ error: "not_found" }, { status: 404, headers });
  const provider = await readProvider(context, placeId);
  const body: ProviderListingResponse = provider
    ? { listed: true, name: provider.name, region: regionOf(provider.region) }
    : { listed: false };
  return Response.json(body, { headers });
}

function regionOf(region: RegionRef): RegionRef {
  return {
    provinceCode: region.provinceCode,
    regencyCode: region.regencyCode,
    ...(region.districtCode ? { districtCode: region.districtCode } : {}),
  };
}

type CorrectionError =
  | "sign_in_required"
  | "app_check_required"
  | "rate_limited"
  | "invalid_submission"
  | "not_found"
  | "unavailable";

async function correctionError(
  request: Request,
  status: number,
  error: CorrectionError,
  extra: { headers?: Headers; fieldErrors?: Record<string, string> } = {},
): Promise<Response> {
  const language = await detectLanguage(request);
  const message = getI18n(language).getFixedT(language)(`providerFields.correction.errors.${error}`);
  return Response.json(
    { error, message, ...(extra.fieldErrors ? { fieldErrors: extra.fieldErrors } : {}) },
    { status, headers: extra.headers },
  );
}

/** The suggestion, trimmed and checked, or the field errors. */
export function parseNameCorrection(
  body: unknown,
):
  | { ok: true; suggestedName?: string; suggestedRegion?: RegionRef }
  | { ok: false; fieldErrors: Record<string, string> } {
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  let suggestedName: string | undefined;
  let suggestedRegion: RegionRef | undefined;

  if (input.suggestedName !== undefined && input.suggestedName !== null) {
    const name = typeof input.suggestedName === "string" ? input.suggestedName.trim() : "";
    if (name.length > TESTIMONY_LIMITS.correctionNameMaxChars) fieldErrors.suggestedName = "too_long";
    else if (name) suggestedName = name;
  }
  if (input.suggestedRegion !== undefined && input.suggestedRegion !== null) {
    const region = input.suggestedRegion as RegionRef;
    if (isValidRegion(region)) suggestedRegion = regionOf(region);
    else fieldErrors.suggestedRegion = "invalid_region";
  }
  if (Object.keys(fieldErrors).length === 0 && !suggestedName && !suggestedRegion) {
    fieldErrors.suggestedName = "required";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, ...(suggestedName ? { suggestedName } : {}), ...(suggestedRegion ? { suggestedRegion } : {}) };
}

/**
 * POST /api/providers/:placeId/name-corrections ("Sarankan koreksi"). App Check, a
 * signed-in Google account and a per-account daily limit, then one open
 * NameCorrectionDoc for the admin. Nothing on the Provider changes here.
 */
export async function nameCorrectionResponse(
  context: AppLoadContext,
  request: Request,
  placeId: string | undefined,
): Promise<Response> {
  const token = request.headers.get(APP_CHECK_HEADER);
  if (!token || !(await context.adapters.appCheck.verify(token))) {
    context.logger.warn("protection", { outcome: "app_check_required", route: "nameCorrection" });
    return correctionError(request, 401, "app_check_required");
  }
  const user = await readSession(context.auth, request.headers.get("cookie"));
  if (!user) return correctionError(request, 401, "sign_in_required");

  const limited = await context.rateLimiter.consume([
    { scope: "ip", key: context.clientIp, route: "all", limit: context.config.limits.ipPerHour, windowSeconds: 3600 },
    { scope: "user", key: user.uid, route: "nameCorrection", limit: NAME_CORRECTIONS_PER_DAY, windowSeconds: 86_400 },
  ]);
  if (!limited.ok) {
    context.logger.warn("protection", { outcome: "rate_limited", route: "nameCorrection", scope: limited.scope });
    const headers = new Headers({ "Retry-After": String(limited.retryAfterSeconds) });
    return correctionError(request, 429, "rate_limited", { headers });
  }

  if (!isPlaceId(placeId)) return correctionError(request, 404, "not_found");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseNameCorrection(body);
  if (!parsed.ok) return correctionError(request, 400, "invalid_submission", { fieldErrors: parsed.fieldErrors });

  if (!context.firestore) return correctionError(request, 503, "unavailable");
  const provider = await readProvider(context, placeId);
  if (!provider) return correctionError(request, 404, "not_found");

  const doc: Omit<NameCorrectionDoc, "createdAt"> & { createdAt: FieldValue } = {
    placeId,
    ...(parsed.suggestedName ? { suggestedName: parsed.suggestedName } : {}),
    ...(parsed.suggestedRegion ? { suggestedRegion: parsed.suggestedRegion } : {}),
    currentName: provider.name,
    currentRegion: regionOf(provider.region),
    suggesterUid: user.uid,
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
  };
  const ref = await context.firestore.collection(COLLECTIONS.nameCorrections).add(doc);
  context.logger.info("name_correction_created", {
    name: Boolean(parsed.suggestedName),
    region: Boolean(parsed.suggestedRegion),
  });
  return Response.json({ id: ref.id }, { status: 201 });
}
