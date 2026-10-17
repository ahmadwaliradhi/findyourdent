/**
 * Port to Google Places (ADR-0001, ADR-0005). Only a fake exists in this ticket;
 * the real adapter lands with spec 02 and must count every call against the daily caps.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface NearbyProviderSearch {
  location: LatLng;
  providerType: "klinik" | "private_dentist" | "hospital";
  requiresEmergencyDepartment?: boolean;
  radiusMeters?: number;
  language: "id" | "en";
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
