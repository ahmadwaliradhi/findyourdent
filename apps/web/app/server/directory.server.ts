// Listed Provider directory (spec 04). Reads FindYourDent's own `providers`
// collection only: no Places call, no Google data besides stored coordinates.
import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import type { Firestore, Query } from "firebase-admin/firestore";
import { DIRECTORY_ROW_LIMIT, type DirectoryRow, type DirectorySort } from "~/lib/directory";
import type { ListingFilters } from "~/lib/listing-filters";
import { normalizeName } from "~/lib/normalize-name";
import { visibleBadgeUntil } from "~/lib/policy-violations";
import { aspectPrior, shrunkAspectScore } from "~/lib/scores";

/**
 * Providers read from Firestore per request, most Proven Testimonies first (or by
 * name under a name search). Filters Firestore cannot express (procedure, Kunjungan
 * terbukti) and the sorts run in memory over these, so a Provider beyond this many
 * matches of the Firestore filters can be missed.
 * Fine while Listed Providers number in the hundreds; revisit before that.
 */
export const DIRECTORY_SCAN_LIMIT = 500;
export interface DirectoryInput {
  filters: ListingFilters;
  /** Name search as typed; matched as a normalised prefix. */
  q: string;
  sort: DirectorySort;
  /** Epoch milliseconds the violation badge is judged at; defaults to now. */
  nowMs?: number;
}

function offersProcedure(provider: ProviderDoc, code: string): boolean {
  if (provider.aggregates.procedurePrices?.[code]) return true;
  const facts = provider.ownerFacts;
  return facts?.moderationStatus === "published" && (facts.services ?? []).includes(code);
}

function toRow(provider: ProviderDoc, score: number | null, nowMs: number): DirectoryRow {
  const { provinceCode, regencyCode, districtCode } = provider.region;
  return {
    placeId: provider.placeId,
    name: provider.name,
    region: districtCode ? { provinceCode, regencyCode, districtCode } : { provinceCode, regencyCode },
    providerType: provider.providerType,
    providerTypeSource: provider.providerTypeSource,
    averages: provider.aggregates.averages,
    testimonyCount: provider.aggregates.testimonyCount,
    verifiedVisitCount: provider.aggregates.verifiedVisitCount,
    claimed: provider.claimStatus === "claimed",
    violationBadgeUntil: visibleBadgeUntil(provider.violationBadge, nowMs),
    score,
    location: provider.location ? { lat: provider.location.lat, lng: provider.location.lng } : null,
  };
}

/**
 * A row with the value the score sort reads: its own score, or the prior mean when unrated.
 * Rounded like the Shortlist's total (ranking.ts), so floating-point noise cannot put a rated
 * Provider whose score equals the mean below the unrated ones.
 */
interface Ranked {
  row: DirectoryRow;
  rank: number;
}

const byName = (a: Ranked, b: Ranked) => a.row.name.localeCompare(b.row.name, "id");
const byProven = (a: Ranked, b: Ranked) => b.row.verifiedVisitCount - a.row.verifiedVisitCount || byName(a, b);
const byScore = (a: Ranked, b: Ranked) => b.rank - a.rank || byProven(a, b);

/**
 * Listed Providers matching the filters and name prefix, sorted. Region and
 * Provider type are Firestore equality filters; the name search is a range on
 * `nameNormalized`. Only Proven Testimonies move the order (spec 09): "testimoni"
 * sorts by `verifiedVisitCount`, and "skor" by the shrunk score, whose prior is the
 * Proven-weighted mean over the Providers read for this request (so it follows the
 * region filter). A Provider without averages sorts at that mean but shows no score.
 */
export async function loadDirectory(
  firestore: Firestore,
  { filters, q, sort, nowMs = Date.now() }: DirectoryInput,
): Promise<DirectoryRow[]> {
  let query: Query = firestore.collection(COLLECTIONS.providers);
  if (filters.provinceCode) query = query.where("region.provinceCode", "==", filters.provinceCode);
  if (filters.regencyCode) query = query.where("region.regencyCode", "==", filters.regencyCode);
  if (filters.districtCode) query = query.where("region.districtCode", "==", filters.districtCode);
  if (filters.providerType) query = query.where("providerType", "==", filters.providerType);

  const prefix = normalizeName(q);
  query = prefix
    ? query.where("nameNormalized", ">=", prefix).where("nameNormalized", "<", `${prefix}`).orderBy("nameNormalized")
    : query.orderBy("aggregates.verifiedVisitCount", "desc");

  const snapshot = await query.limit(DIRECTORY_SCAN_LIMIT).get();
  const providers = snapshot.docs.map((doc) => doc.data() as ProviderDoc);
  const prior = aspectPrior(providers.map((p) => p.aggregates));

  const ranked = providers
    .filter((p) => !filters.verifiedOnly || p.aggregates.verifiedVisitCount > 0)
    .filter((p) => !filters.procedureCode || offersProcedure(p, filters.procedureCode))
    .map((p): Ranked => {
      const score = shrunkAspectScore(p.aggregates, prior);
      return { row: toRow(p, score, nowMs), rank: Math.round((score ?? prior.mean) * 1e9) / 1e9 };
    });

  ranked.sort(sort === "skor" ? byScore : byProven);
  return ranked.slice(0, DIRECTORY_ROW_LIMIT).map(({ row }) => row);
}
