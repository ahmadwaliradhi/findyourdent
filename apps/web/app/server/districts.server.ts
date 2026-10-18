// Kecamatan names (spec 08). data/districts.json is about 700 KB, so it stays on the
// server: pages get the kecamatan of one kota/kabupaten at a time, from a loader or
// from GET /api/regions/:regencyCode/districts.
import districtList from "@findyourdent/contracts/data/districts.json";
import type { DistrictOption, InitialDistricts } from "~/lib/regions";

const districtNames = new Map(districtList.districts.map((d) => [d.code, d.name] as const));
// A plain loop, not Map.groupBy, like lib/regions.
const districtsByRegency = new Map<string, DistrictOption[]>();
for (const { code, regencyCode, name } of districtList.districts) {
  const list = districtsByRegency.get(regencyCode) ?? [];
  list.push({ code, name });
  districtsByRegency.set(regencyCode, list);
}

/** The kecamatan of one kota/kabupaten in list order, or undefined for an unknown code. */
export function districtsOf(regencyCode: string): DistrictOption[] | undefined {
  return districtsByRegency.get(regencyCode);
}

/** The kecamatan name, or undefined for a code not in the list. */
export function districtName(code: string): string | undefined {
  return districtNames.get(code);
}

/** For a listing page's loader: the kecamatan of the kota in its filters, or null without a kota. */
export function initialDistrictsOf(regencyCode: string | undefined): InitialDistricts | null {
  const districts = regencyCode ? districtsOf(regencyCode) : undefined;
  return regencyCode && districts ? { regencyCode, districts } : null;
}
