import { type Guidance, REGIONS } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  type PriceListDoc,
  type ProcedureCode,
  type ProviderDoc,
  type ProviderType,
  type Timestamp,
} from "@findyourdent/contracts/firestore";
import type { AppLoadContext } from "react-router";
import { getI18n, type Language } from "~/i18n/config";
import { formatDistance } from "~/lib/format";
import { procedureLabel } from "~/lib/procedures";
import type { PriceSignal, ShortlistProvider, ShortlistResponse } from "~/lib/shortlist";
import type { LatLng, PlaceSummary, TextSearch } from "../../server/adapters/places.ts";
import { jakartaDate } from "../../server/quota.ts";
import {
  HOSPITAL_PROCEDURES,
  isDiagnostic,
  meanRating,
  type RankedProvider,
  type RankingCandidate,
  rankProviders,
} from "./ranking.ts";
import { readShareToken } from "./share.server.ts";

/**
 * Shortlist (spec 02): one Places Text Search, joined with Firestore by place_id and
 * ranked deterministically; Listed Providers within about 10 km plus a Google Maps
 * search link when the day's Places cap is used up. Google facts stay in memory.
 * The Patient's location and typed area are never logged or stored.
 */

export type ShortlistOutcome =
  | { ok: true; response: ShortlistResponse }
  | { ok: false; status: 400; error: "invalid_request" };

type Where = { location: LatLng; area?: undefined } | { area: string; location?: undefined };

interface ShortlistRequest {
  purpose: "shortlist" | "emergency";
  where: Where;
  /** Absent for the emergency card. */
  guidance: Guidance | null;
}

const SEARCH_RADIUS_METERS = 5000;
/** A median price paid is shown only with at least this many Testimony prices (spec 02). */
const MIN_PRICES_FOR_MEDIAN = 2;
const FALLBACK_RADIUS_METERS = 10_000;
const FALLBACK_LIMIT = 200;
const MAX_AREA_LENGTH = 100;
/** Generous box around Indonesia; anything outside cannot be a Patient here. */
const INDONESIA = { minLat: -11.5, maxLat: 6.5, minLng: 94.5, maxLng: 141.5 };

function parseLocation(value: unknown): LatLng | null {
  if (typeof value !== "object" || value === null) return null;
  const { lat, lng } = value as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < INDONESIA.minLat || lat > INDONESIA.maxLat || lng < INDONESIA.minLng || lng > INDONESIA.maxLng) return null;
  return { lat, lng };
}

function parseRequest(body: unknown, shareLinkSecret: string): ShortlistRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const input = body as Record<string, unknown>;
  const purpose = input.purpose;
  if (purpose !== "shortlist" && purpose !== "emergency") return null;

  let where: Where;
  const area = typeof input.area === "string" ? input.area.trim() : "";
  if (input.location !== undefined && input.area === undefined) {
    const location = parseLocation(input.location);
    if (!location) return null;
    where = { location };
  } else if (input.location === undefined && area.length >= 2 && area.length <= MAX_AREA_LENGTH) {
    where = { area };
  } else {
    return null;
  }

  if (purpose === "emergency") return { purpose, where, guidance: null };
  const guidance =
    typeof input.guidanceToken === "string" ? readShareToken(input.guidanceToken, shareLinkSecret) : null;
  return guidance ? { purpose, where, guidance } : null;
}

/** Specialist and surgical referrals go to a Hospital search; everything else to dentists (spec 02). */
function searchFor(request: ShortlistRequest): { base: string; includedType: TextSearch["includedType"] } {
  if (request.purpose === "emergency") return { base: "IGD rumah sakit", includedType: "hospital" };
  const referral = (request.guidance?.likelyProcedures ?? []).some((code) => HOSPITAL_PROCEDURES.has(code));
  return referral
    ? { base: "poli gigi rumah sakit", includedType: "hospital" }
    : { base: "dokter gigi", includedType: "dentist" };
}

/** Plain Google Maps search URL (no API call). Never carries coordinates or complaint text. */
function mapsSearchUrl(base: string, where: Where): string {
  const query = where.area ? `${base} di ${where.area}` : `${base} terdekat`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** A Provider's Google Maps page, as a plain search URL (no API call). */
export function placeMapsUrl(name: string, placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

const PRIVATE_DENTIST_NAME = /^(drg\.?|dokter gigi)\s+\p{L}/iu;

/** Provider type when no Claim confirms it (spec 02); shown with "perkiraan". */
export function inferProviderType(place: Pick<PlaceSummary, "displayName" | "types">): ProviderType {
  if (place.types.includes("hospital")) return "hospital";
  if (PRIVATE_DENTIST_NAME.test(place.displayName.trim())) return "privateDentist";
  return "klinik";
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Kota/kabupaten codes whose name appears in a typed area ("Gubeng, Surabaya" → Kota Surabaya). */
function regencyCodesIn(area: string): string[] {
  const words = ` ${normalize(area)} `;
  return REGIONS.regencies
    .filter((regency) => {
      const name = normalize(regency.name.replace(/^(kota|kabupaten)\s+/i, ""));
      return name.length > 0 && words.includes(` ${name} `);
    })
    .map((regency) => regency.code);
}

interface Facts {
  providers: Map<string, ProviderDoc>;
  priceLists: Map<string, PriceListDoc>;
}

async function readFacts(context: AppLoadContext, placeIds: string[]): Promise<Facts> {
  const facts: Facts = { providers: new Map(), priceLists: new Map() };
  const { firestore } = context;
  if (!firestore || placeIds.length === 0) return facts;
  const collection = firestore.collection(COLLECTIONS.providers);
  const docs = await firestore.getAll(...placeIds.map((id) => collection.doc(id)));
  for (const doc of docs) if (doc.exists) facts.providers.set(doc.id, doc.data() as ProviderDoc);
  await addPriceLists(context, facts);
  return facts;
}

async function addPriceLists(context: AppLoadContext, facts: Facts): Promise<void> {
  const claimed = [...facts.providers.values()].filter((p) => p.claimStatus === "claimed").map((p) => p.placeId);
  if (!context.firestore || claimed.length === 0) return;
  // `in` takes at most 30 values; a Shortlist joins at most 20 search results.
  for (let i = 0; i < claimed.length; i += 30) {
    const snapshot = await context.firestore
      .collection(COLLECTIONS.priceLists)
      .where("placeId", "in", claimed.slice(i, i + 30))
      .where("status", "==", "current")
      .get();
    for (const doc of snapshot.docs) {
      const list = doc.data() as PriceListDoc;
      facts.priceLists.set(list.placeId, list);
    }
  }
}

async function readNearbyListed(context: AppLoadContext, where: Where): Promise<Facts> {
  const facts: Facts = { providers: new Map(), priceLists: new Map() };
  const { firestore } = context;
  if (!firestore) return facts;
  const collection = firestore.collection(COLLECTIONS.providers);
  if (where.location) {
    // A latitude band of about 11 km each way, then the exact distance in memory.
    const band = FALLBACK_RADIUS_METERS / 111_000 + 0.01;
    const snapshot = await collection
      .where("location.lat", ">=", where.location.lat - band)
      .where("location.lat", "<=", where.location.lat + band)
      .limit(FALLBACK_LIMIT)
      .get();
    for (const doc of snapshot.docs) {
      const provider = doc.data() as ProviderDoc;
      if (provider.location && distanceMeters(where.location, provider.location) <= FALLBACK_RADIUS_METERS) {
        facts.providers.set(doc.id, provider);
      }
    }
  } else {
    const codes = regencyCodesIn(where.area).slice(0, 30);
    if (codes.length > 0) {
      const snapshot = await collection.where("region.regencyCode", "in", codes).limit(FALLBACK_LIMIT).get();
      for (const doc of snapshot.docs) facts.providers.set(doc.id, doc.data() as ProviderDoc);
    }
  }
  await addPriceLists(context, facts);
  return facts;
}

interface Joined {
  candidate: RankingCandidate;
  name: string;
  providerTypeSource: "inferred" | "claimed";
  listed: boolean;
  formattedAddress?: string;
  googleMapsUri: string;
  provider?: ProviderDoc;
  priceList?: PriceListDoc;
}

function representativePrices(provider: ProviderDoc | undefined, priceList: PriceListDoc | undefined) {
  const prices: Partial<Record<ProcedureCode, number>> = {};
  for (const row of priceList?.rows ?? []) {
    if (row.procedureCode) prices[row.procedureCode] = (row.minRupiah + row.maxRupiah) / 2;
  }
  for (const [code, aggregate] of Object.entries(provider?.aggregates.procedurePrices ?? {})) {
    if (aggregate.count >= MIN_PRICES_FOR_MEDIAN) prices[code] = aggregate.medianRupiah;
  }
  return prices;
}

function join(placeId: string, place: PlaceSummary | undefined, facts: Facts, where: Where): Joined {
  const provider = facts.providers.get(placeId);
  const priceList = facts.priceLists.get(placeId);
  const name = provider?.name ?? place?.displayName ?? placeId;
  const location = place?.location ?? provider?.location;
  const services = provider?.ownerFacts?.moderationStatus === "published" ? (provider.ownerFacts.services ?? []) : [];
  return {
    candidate: {
      placeId,
      providerType: provider?.providerType ?? inferProviderType({ displayName: name, types: place?.types ?? [] }),
      claimStatus: provider?.claimStatus ?? "unclaimed",
      services,
      distanceMeters: where.location && location ? Math.round(distanceMeters(where.location, location)) : null,
      testimonies: {
        count: provider?.aggregates.testimonyCount ?? 0,
        verifiedVisitCount: provider?.aggregates.verifiedVisitCount ?? 0,
        averages: provider?.aggregates.averages ?? null,
      },
      prices: representativePrices(provider, priceList),
    },
    name,
    providerTypeSource: provider?.providerTypeSource ?? "inferred",
    listed: provider !== undefined,
    ...(place?.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    googleMapsUri: place?.googleMapsUri ?? placeMapsUrl(name, placeId),
    provider,
    priceList,
  };
}

const dateOf = (timestamp: Timestamp) => jakartaDate(timestamp.toMillis());

/** In order: median price paid (two or more), the Price List, then the Cost Estimate (spec 02). */
function priceSignals(joined: Joined, guidance: Guidance | null): PriceSignal[] {
  const signals: PriceSignal[] = [];
  for (const estimate of guidance?.costEstimate ?? []) {
    const code = estimate.procedureCode;
    const paid = joined.provider?.aggregates.procedurePrices[code];
    if (paid && paid.count >= MIN_PRICES_FOR_MEDIAN && joined.provider) {
      signals.push({
        procedureCode: code,
        source: "testimonies",
        minRupiah: paid.medianRupiah,
        maxRupiah: paid.medianRupiah,
        asOf: dateOf(joined.provider.updatedAt),
      });
    }
    const row = joined.priceList?.rows.find((r) => r.procedureCode === code);
    if (row && joined.priceList) {
      signals.push({
        procedureCode: code,
        source: "priceList",
        minRupiah: row.minRupiah,
        maxRupiah: row.maxRupiah,
        asOf: dateOf(joined.priceList.confirmedAt),
      });
    }
    signals.push({
      procedureCode: code,
      source: "costEstimate",
      minRupiah: estimate.minRupiah,
      maxRupiah: estimate.maxRupiah,
    });
  }
  return signals;
}

/** Templated one-line reason until the Shortlist Gemini call (T09) writes one. */
function templatedReason(ranked: RankedProvider, request: ShortlistRequest, language: Language): string {
  const t = getI18n(language).getFixedT(language);
  const distance = ranked.distanceMeters === null ? null : formatDistance(ranked.distanceMeters, language);
  if (request.purpose === "emergency") {
    return distance ? t("shortlist.reason.emergency", { distance }) : t("shortlist.reason.emergencyNoDistance");
  }
  const referral = ranked.procedureFit.find((code) => HOSPITAL_PROCEDURES.has(code));
  if (referral && ranked.providerType === "hospital") {
    return t("shortlist.reason.hospitalFit", { procedure: procedureLabel(referral, language) });
  }
  if (referral && ranked.services.includes(referral)) {
    return t("shortlist.reason.listedService", { procedure: procedureLabel(referral, language) });
  }
  const { count, averages } = ranked.testimonies;
  if (count > 0 && averages) {
    const score = meanRating(averages);
    return t("shortlist.reason.testimonies", {
      score: score.toLocaleString(language === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }),
      count,
    });
  }
  if (distance) return t("shortlist.reason.distance", { distance });
  const procedure = ranked.procedureFit.find((code) => !isDiagnostic(code)) ?? ranked.procedureFit[0];
  return procedure
    ? t("shortlist.reason.procedure", { procedure: procedureLabel(procedure, language) })
    : t("shortlist.reason.generic");
}

function toShortlistProvider(
  ranked: RankedProvider,
  joined: Joined,
  request: ShortlistRequest,
  language: Language,
): ShortlistProvider {
  const { count, verifiedVisitCount, averages } = ranked.testimonies;
  return {
    placeId: ranked.placeId,
    rank: ranked.rank,
    name: joined.name,
    providerType: ranked.providerType,
    providerTypeSource: joined.providerTypeSource,
    listed: joined.listed,
    claimed: ranked.claimStatus === "claimed",
    distanceMeters: ranked.distanceMeters,
    ...(joined.formattedAddress ? { formattedAddress: joined.formattedAddress } : {}),
    googleMapsUri: joined.googleMapsUri,
    testimonies: { count, verifiedVisitCount, ...(averages ? { averages } : {}) },
    priceSignals: priceSignals(joined, request.guidance),
    reason: templatedReason(ranked, request, language),
  };
}

export async function buildShortlist(
  context: AppLoadContext,
  input: { body: unknown; language: Language },
): Promise<ShortlistOutcome> {
  const request = parseRequest(input.body, context.config.shareLinkSecret);
  if (!request) {
    context.logger.warn("shortlist", { outcome: "invalid_request" });
    return { ok: false, status: 400, error: "invalid_request" };
  }
  const { base, includedType } = searchFor(request);
  const { where } = request;
  const search: TextSearch = {
    purpose: request.purpose,
    textQuery: where.area ? `${base} di ${where.area}` : base,
    includedType,
    ...(where.location ? { locationBias: { center: where.location, radiusMeters: SEARCH_RADIUS_METERS } } : {}),
    language: input.language,
  };

  const result = await context.adapters.places.searchText(search);
  let joined: Joined[];
  let source: ShortlistResponse["source"];
  if (result.ok) {
    source = "places";
    const facts = await readFacts(
      context,
      result.places.map((p) => p.placeId),
    );
    joined = result.places.map((place) => join(place.placeId, place, facts, where));
  } else {
    source = "listedProviders";
    const facts = await readNearbyListed(context, where);
    joined = [...facts.providers.keys()].map((placeId) => join(placeId, undefined, facts, where));
  }

  const ranked = rankProviders(
    joined.map((j) => j.candidate),
    {
      purpose: request.purpose,
      likelyProcedures: request.guidance?.likelyProcedures ?? [],
      costEstimate: request.guidance?.costEstimate ?? [],
    },
  );
  const byId = new Map(joined.map((j) => [j.candidate.placeId, j]));
  const providers = ranked.map((r) => toShortlistProvider(r, byId.get(r.placeId) as Joined, request, input.language));

  context.logger.info("shortlist", {
    outcome: result.ok ? "ok" : `fallback_${result.reason}`,
    purpose: request.purpose,
    source,
    count: providers.length,
  });
  return {
    ok: true,
    response: {
      source,
      providers,
      ...(source === "listedProviders" || providers.length === 0 ? { mapsSearchUrl: mapsSearchUrl(base, where) } : {}),
    },
  };
}
