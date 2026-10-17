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

/** "Kota Jakarta Pusat, DKI Jakarta". Kecamatan names are not in the region list, so they are not shown. */
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
 * own kota/kabupaten from the Kemendagri list. The list has no kecamatan, so an
 * optional `districtCode` is only checked for shape (`NN.NN.NN` inside the kota).
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
