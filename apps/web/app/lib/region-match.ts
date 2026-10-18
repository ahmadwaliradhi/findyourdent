// Region pre-fill (spec 08): the address text Google's Autocomplete already showed for a
// picked place, read against the Kemendagri list, gives a Region suggestion for the
// Testimony form. Pure and in the browser: no network call, and the text is never kept.
import type { RegionRef } from "@findyourdent/contracts/firestore";
import { normalizeName } from "~/lib/normalize-name";
import { type DistrictOption, PROVINCES, regenciesOf } from "~/lib/regions";

/** Each code is present only when exactly one name matched at its level, inside the level above. */
export type RegionSuggestion = Partial<Pick<RegionRef, "provinceCode" | "regencyCode" | "districtCode">>;

/** As normalizeName, with apostrophes dropped ("Ki'e" is "kie") and postal codes left out. */
function normalize(text: string): string {
  return normalizeName(text.replace(/['’`]/g, ""))
    .split(" ")
    .filter((word) => word && !/^\d+$/.test(word))
    .join(" ");
}

// The names Google uses for a province besides the Kemendagri one, in Indonesian and English.
const PROVINCE_ALIASES: Record<string, string[]> = {
  "11": ["nanggroe aceh darussalam"],
  "12": ["north sumatra"],
  "13": ["west sumatra"],
  "16": ["south sumatra"],
  "19": ["bangka belitung", "bangka belitung islands"],
  "21": ["riau islands"],
  "31": ["dki jakarta", "jakarta", "daerah khusus jakarta", "special capital region of jakarta"],
  "32": ["west java"],
  "33": ["central java"],
  "34": ["di yogyakarta", "yogyakarta", "special region of yogyakarta"],
  "35": ["east java"],
  "52": ["west nusa tenggara"],
  "53": ["east nusa tenggara"],
  "61": ["west kalimantan"],
  "62": ["central kalimantan"],
  "63": ["south kalimantan"],
  "64": ["east kalimantan"],
  "65": ["north kalimantan"],
  "71": ["north sulawesi"],
  "72": ["central sulawesi"],
  "73": ["south sulawesi"],
  "74": ["southeast sulawesi"],
  "76": ["west sulawesi"],
  "82": ["north maluku"],
  "92": ["west papua"],
  "93": ["south papua"],
  "94": ["central papua"],
  "95": ["highland papua"],
  "96": ["southwest papua"],
};

const provinceByName = new Map<string, string[]>();
for (const { code, name } of PROVINCES) {
  for (const key of [normalize(name), ...(PROVINCE_ALIASES[code] ?? [])]) {
    provinceByName.set(key, [...(provinceByName.get(key) ?? []), code]);
  }
}

type RegencyType = "kota" | "kabupaten";

/** "Kota Administrasi Jakarta Pusat" -> kota "jakarta pusat"; "Kab. Malang" or "Malang Regency" -> kabupaten "malang". */
function regencyParts(segment: string): { type?: RegencyType; base: string } {
  const prefixed = /^(kota|kabupaten|kab)(?: administrasi)? (.+)$/.exec(segment);
  if (prefixed?.[1] && prefixed[2]) return { type: prefixed[1] === "kota" ? "kota" : "kabupaten", base: prefixed[2] };
  const suffixed = /^(.+) (city|regency)$/.exec(segment);
  if (suffixed?.[1] && suffixed[2]) return { type: suffixed[2] === "city" ? "kota" : "kabupaten", base: suffixed[1] };
  return { base: segment };
}

/** The one value in `found`, or undefined when there are none or several. */
function onlyOne(found: Set<string>): string | undefined {
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * The Region an address names. Each comma-separated part is compared, whole, with the
 * names at each level; a level is filled only when exactly one name matches inside
 * the level above, and a level left empty leaves every level below it empty.
 * `districts` are the kecamatan of the kota/kabupaten the address turns out to name
 * (they are loaded one kota at a time); without them no kecamatan is suggested.
 */
export function matchRegion(address: string, districts?: DistrictOption[]): RegionSuggestion {
  const segments = address.split(",").map(normalize).filter(Boolean);

  const provinceCode = onlyOne(new Set(segments.flatMap((segment) => provinceByName.get(segment) ?? [])));
  if (!provinceCode) return {};

  const regencies = regenciesOf(provinceCode).map((r) => ({ code: r.code, ...regencyParts(normalize(r.name)) }));
  const regencyMatches = new Set<string>();
  const regencySegments = new Set<string>();
  for (const segment of segments) {
    const { type, base } = regencyParts(segment);
    for (const regency of regencies) {
      if (regency.base === base && (!type || regency.type === type)) {
        regencyMatches.add(regency.code);
        regencySegments.add(segment);
      }
    }
  }
  const regencyCode = onlyOne(regencyMatches);
  if (!regencyCode) return { provinceCode };

  // "Kec. Gubeng" names the kecamatan for sure; a bare "Gubeng" may be a kelurahan, so
  // bare parts count only when no part says Kec./Kecamatan. The part that named the
  // kota/kabupaten never counts: "Sleman" is Kabupaten Sleman, not also Kecamatan Sleman.
  const marked = segments.flatMap((segment) => /^(?:kec|kecamatan) (.+)$/.exec(segment)?.[1] ?? []);
  const candidates = new Set(marked.length > 0 ? marked : segments.filter((segment) => !regencySegments.has(segment)));
  const districtCode = onlyOne(
    new Set((districts ?? []).filter((d) => candidates.has(normalize(d.name))).map((d) => d.code)),
  );
  return districtCode ? { provinceCode, regencyCode, districtCode } : { provinceCode, regencyCode };
}
