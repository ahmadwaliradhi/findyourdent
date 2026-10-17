/**
 * Port to Google Places (ADR-0001, ADR-0005). Only a fake exists in this ticket;
 * the real adapter lands with spec 02 and must count every call against the daily caps.
 */
import type { ProviderType } from "@findyourdent/contracts/firestore";
import type { Language } from "../../app/i18n/config.ts";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface NearbyProviderSearch {
  location: LatLng;
  providerType: ProviderType;
  requiresEmergencyDepartment?: boolean;
  radiusMeters?: number;
  language: Language;
}

export interface PlaceSummary {
  placeId: string;
  displayName: string;
  location: LatLng;
  googleMapsUri?: string;
}

export interface PlacesAdapter {
  searchNearby(search: NearbyProviderSearch): Promise<PlaceSummary[]>;
}
