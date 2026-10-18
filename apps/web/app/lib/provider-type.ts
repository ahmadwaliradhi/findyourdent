// Provider type inference (spec 02). A plain module: the coordinate refresh job runs
// server/ unbundled and can import app/lib, not app/server.
import type { ProviderType } from "@findyourdent/contracts/firestore";

const PRIVATE_DENTIST_NAME = /^(drg\.?|dokter gigi)\s+\p{L}/iu;

/** Provider type when no Claim confirms it (spec 02); shown with "perkiraan". */
export function inferProviderType(place: { displayName: string; types: readonly string[] }): ProviderType {
  if (place.types.includes("hospital") || place.types.includes("general_hospital")) return "hospital";
  if (PRIVATE_DENTIST_NAME.test(place.displayName.trim())) return "privateDentist";
  return "klinik";
}
