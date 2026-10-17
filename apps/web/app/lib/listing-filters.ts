// Filters shared by the landing feed and the Listed Provider directory (spec 04).
// They live in the URL so filtered views are shareable and indexable.
// Import data files only (not the contracts index) so Ajv stays out of the browser bundle.
import procedureList from "@findyourdent/contracts/data/procedures.json";
import regionList from "@findyourdent/contracts/data/regions.json";
import type { ProviderType } from "@findyourdent/contracts/firestore";

export interface ListingFilters {
  provinceCode?: string;
  regencyCode?: string;
  districtCode?: string;
  procedureCode?: string;
  providerType?: ProviderType;
  /** Kunjungan terbukti only. */
  verifiedOnly: boolean;
}

/** URL parameter names, in Indonesian for readable shared links. */
export const FILTER_PARAMS = {
  provinceCode: "provinsi",
  regencyCode: "kota",
  districtCode: "kecamatan",
  procedureCode: "prosedur",
  providerType: "jenis",
  verifiedOnly: "terbukti",
} as const;

const PROVIDER_TYPES: readonly ProviderType[] = ["klinik", "privateDentist", "hospital"];
const provinceCodes = new Set(regionList.provinces.map((p) => p.code));
const regencyProvince = new Map(regionList.regencies.map((r) => [r.code, r.provinceCode] as const));
const procedureCodes = new Set(procedureList.procedures.map((p) => p.code));
const DISTRICT_CODE = /^\d{2}\.\d{2}\.\d{2}$/;

/**
 * Reads filters from a URL. Unknown or inconsistent values are dropped rather
 * than rejected, so an old or hand-edited link still shows a sensible page.
 * A kota implies its province; a kecamatan needs its kota.
 */
export function parseListingFilters(params: URLSearchParams): ListingFilters {
  const read = (name: string) => params.get(name)?.trim() || undefined;
  const filters: ListingFilters = { verifiedOnly: read(FILTER_PARAMS.verifiedOnly) === "1" };

  let provinceCode = read(FILTER_PARAMS.provinceCode);
  if (provinceCode && !provinceCodes.has(provinceCode)) provinceCode = undefined;
  const regencyCode = read(FILTER_PARAMS.regencyCode);
  const regencyParent = regencyCode ? regencyProvince.get(regencyCode) : undefined;
  if (regencyCode && regencyParent && (!provinceCode || provinceCode === regencyParent)) {
    filters.provinceCode = regencyParent;
    filters.regencyCode = regencyCode;
    const districtCode = read(FILTER_PARAMS.districtCode);
    if (districtCode && DISTRICT_CODE.test(districtCode) && districtCode.startsWith(`${regencyCode}.`)) {
      filters.districtCode = districtCode;
    }
  } else if (provinceCode) {
    filters.provinceCode = provinceCode;
  }

  const procedureCode = read(FILTER_PARAMS.procedureCode);
  if (procedureCode && procedureCodes.has(procedureCode)) filters.procedureCode = procedureCode;
  const providerType = read(FILTER_PARAMS.providerType);
  if (providerType && (PROVIDER_TYPES as readonly string[]).includes(providerType)) {
    filters.providerType = providerType as ProviderType;
  }
  return filters;
}

/** The URL parameters for a set of filters, in a stable order. */
export function listingFiltersToParams(filters: ListingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.provinceCode) params.set(FILTER_PARAMS.provinceCode, filters.provinceCode);
  if (filters.regencyCode) params.set(FILTER_PARAMS.regencyCode, filters.regencyCode);
  if (filters.districtCode) params.set(FILTER_PARAMS.districtCode, filters.districtCode);
  if (filters.procedureCode) params.set(FILTER_PARAMS.procedureCode, filters.procedureCode);
  if (filters.providerType) params.set(FILTER_PARAMS.providerType, filters.providerType);
  if (filters.verifiedOnly) params.set(FILTER_PARAMS.verifiedOnly, "1");
  return params;
}

export function hasActiveFilters(filters: ListingFilters): boolean {
  return listingFiltersToParams(filters).size > 0;
}
