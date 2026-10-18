// Import the data file only (not the package index) so Ajv stays out of the browser bundle.
import regionList from "@findyourdent/contracts/data/regions.json";
import type { RegionRef } from "@findyourdent/contracts/firestore";

export const PROVINCES = regionList.provinces;
export const REGENCIES = regionList.regencies;

const provinceNames = new Map(PROVINCES.map((p) => [p.code, p.name] as const));
const regencyNames = new Map(REGENCIES.map((r) => [r.code, r.name] as const));

export function provinceName(code: string): string {
  return provinceNames.get(code) ?? code;
}

export function regencyName(code: string): string {
  return regencyNames.get(code) ?? code;
}

/** One kecamatan, as the Region fields list it. Names live in data/districts.json, which stays on the server (server/districts.server.ts). */
export interface DistrictOption {
  code: string;
  name: string;
}

/** The kecamatan of one kota/kabupaten, sent by a loader so the Kecamatan select renders filled before JavaScript runs. */
export interface InitialDistricts {
  regencyCode: string;
  districts: DistrictOption[];
}

/** What a listing page's loader sends about the kecamatan level of its filters. */
export interface ListingDistricts {
  /** The kecamatan of the kota in the filters, for the Kecamatan select; null without a kota. */
  options: InitialDistricts | null;
  /** The name of the kecamatan in the filters, for headings and meta; null without one. */
  chosenName: string | null;
}

/** "Kota Jakarta Pusat, DKI Jakarta". Kecamatan names are not loaded here; see DistrictOption. */
export function regionLabel(region: Pick<RegionRef, "provinceCode" | "regencyCode">): string {
  return `${regencyName(region.regencyCode)}, ${provinceName(region.provinceCode)}`;
}

const regencyProvince = new Map(REGENCIES.map((r) => [r.code, r.provinceCode] as const));
// A plain loop, not Map.groupBy: older Android browsers still visit.
const regenciesByProvince = new Map<string, typeof REGENCIES>();
for (const regency of REGENCIES) {
  const list = regenciesByProvince.get(regency.provinceCode) ?? [];
  list.push(regency);
  regenciesByProvince.set(regency.provinceCode, list);
}

/** The kota/kabupaten of one province, in list order, for the second Region select. */
export function regenciesOf(provinceCode: string): typeof REGENCIES {
  return regenciesByProvince.get(provinceCode) ?? [];
}

/**
 * A Region a Testimony or a "Sarankan koreksi" may carry: a province and one of its
 * own kota/kabupaten from the Kemendagri list. An optional `districtCode` is only
 * checked for shape (`NN.NN.NN` inside the kota), so every kecamatan of
 * data/districts.json passes without shipping that list to the browser.
 * Pure, for the form and the server alike.
 */
export function isValidRegion(region: { provinceCode: string; regencyCode: string; districtCode?: string }): boolean {
  if (typeof region !== "object" || region === null) return false;
  const { provinceCode, regencyCode, districtCode } = region;
  if (typeof provinceCode !== "string" || typeof regencyCode !== "string") return false;
  if (!provinceNames.has(provinceCode) || regencyProvince.get(regencyCode) !== provinceCode) return false;
  if (districtCode === undefined) return true;
  return (
    typeof districtCode === "string" && new RegExp(`^${regencyCode.replace(".", "\\.")}\\.\\d{2}$`).test(districtCode)
  );
}
