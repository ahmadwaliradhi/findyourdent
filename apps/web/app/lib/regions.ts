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
