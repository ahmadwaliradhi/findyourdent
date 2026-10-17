import type { ProcedureCode, ProviderType } from "@findyourdent/contracts/firestore";

// What POST /api/shortlist returns (app/server/shortlist.server.ts), shared with the page.

export interface PriceSignal {
  procedureCode: ProcedureCode;
  /** testimonies: median price paid (at least two); priceList: owner's Price List; costEstimate: Guidance estimasi. */
  source: "testimonies" | "priceList" | "costEstimate";
  minRupiah: number;
  maxRupiah: number;
  /** `YYYY-MM-DD` the price was last confirmed; absent for the Cost Estimate. */
  asOf?: string;
}

export interface ShortlistProvider {
  placeId: string;
  rank: number;
  /** Listed Provider name, else Google's live display name (never stored). */
  name: string;
  providerType: ProviderType;
  /** inferred is shown as "perkiraan". */
  providerTypeSource: "inferred" | "claimed";
  listed: boolean;
  claimed: boolean;
  /** null when the Patient typed an area. */
  distanceMeters: number | null;
  /** Live from Google, shown only. */
  formattedAddress?: string;
  googleMapsUri: string;
  testimonies: {
    count: number;
    verifiedVisitCount: number;
    averages?: { service: number; hygiene: number; materialsEquipment: number };
  };
  priceSignals: PriceSignal[];
  /** One line from the Shortlist Gemini call (T09), else a templated reason. */
  reason: string;
}

export interface ShortlistResponse {
  /** listedProviders: the Places cap was reached or Places failed. */
  source: "places" | "listedProviders";
  providers: ShortlistProvider[];
  /** "Cari di Google Maps": a plain Maps search URL, no API call. Present on the fallback. */
  mapsSearchUrl?: string;
}
