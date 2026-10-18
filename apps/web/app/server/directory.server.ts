// Listed Provider directory (spec 04). Reads FindYourDent's own `providers`
// collection only: no Places call, no Google data besides stored coordinates.
import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import type { Firestore, Query } from "firebase-admin/firestore";
import { DIRECTORY_ROW_LIMIT, type DirectoryRow, type DirectorySort } from "~/lib/directory";
import type { ListingFilters } from "~/lib/listing-filters";
import { normalizeName } from "~/lib/normalize-name";
import { aspectPrior, shrunkAspectScore } from "~/lib/scores";

/**
 * Providers read from Firestore per request. Filters Firestore cannot express
 * (procedure, Kunjungan terbukti) and the sorts run in memory over these, so a
 * Provider beyond this many matches of the Firestore filters can be missed.
 * Fine while Listed Providers number in the hundreds; revisit before that.
 */
export const DIRECTORY_SCAN_LIMIT = 500;
export interface DirectoryInput {
  filters: ListingFilters;
  /** Name search as typed; matched as a normalised prefix. */
  q: string;
  sort: DirectorySort;
}

function offersProcedure(provider: ProviderDoc, code: string): boolean {
  if (provider.aggregates.procedurePrices?.[code]) return true;
  const facts = provider.ownerFacts;
  return facts?.moderationStatus === "published" && (facts.services ?? []).includes(code);
}

function toRow(provider: ProviderDoc, score: number | null): DirectoryRow {
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
    score,
    location: provider.location ? { lat: provider.location.lat, lng: provider.location.lng } : null,
  };
}

const byName = (a: DirectoryRow, b: DirectoryRow) => a.name.localeCompare(b.name, "id");
/**
 * "Most Testimonies" counts Proven ones only, and ties go to the name, never to the
 * count of all Testimonies: unproven Testimonies cannot move a row (spec 09).
 */
const byProvenTestimonies = (a: DirectoryRow, b: DirectoryRow) =>
  b.verifiedVisitCount - a.verifiedVisitCount || byName(a, b);
const byScore = (a: DirectoryRow, b: DirectoryRow) =>
  (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) || byProvenTestimonies(a, b);

/**
 * Listed Providers matching the filters and name prefix, sorted. Region and
 * Provider type are Firestore equality filters; the name search is a range on
 * `nameNormalized`. The score prior is the Proven-Testimony-weighted mean over the
 * Providers read for this request (so it follows the region filter).
 */
export async function loadDirectory(
  firestore: Firestore,
  { filters, q, sort }: DirectoryInput,
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

  const rows = providers
    .filter((p) => !filters.verifiedOnly || p.aggregates.verifiedVisitCount > 0)
    .filter((p) => !filters.procedureCode || offersProcedure(p, filters.procedureCode))
    .map((p) => toRow(p, shrunkAspectScore(p.aggregates, prior)));

  rows.sort(sort === "skor" ? byScore : byProvenTestimonies);
  return rows.slice(0, DIRECTORY_ROW_LIMIT);
}
