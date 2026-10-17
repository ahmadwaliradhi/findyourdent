import type { ProviderType } from "@findyourdent/contracts/firestore";

// What the Provider page's two Google routes return (app/server/provider.server.ts),
// shared with the page, plus the owner facts its loader passes through.

/** Owner-entered facts from an approved Claim, shown only once moderation published them. */
export interface OwnerFacts {
  address?: string;
  phone?: string;
  whatsappUri?: string;
  website?: string;
  openingHours?: string;
}

/** Live from Google through GET /api/providers/:placeId/google. Shown, never stored. */
export interface ProviderGoogleBlock {
  displayName: string;
  /** The Listed Provider's type, else inferred from Google's types and name (spec 02). */
  providerType: ProviderType;
  formattedAddress?: string;
  openNow?: boolean;
  weekdayHours?: string[];
  nationalPhoneNumber?: string;
  /** Present only for a mobile number, which is the one WhatsApp can reach. */
  whatsappUri?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri: string;
}

export type PlacesUnavailableReason = "cap_reached" | "not_found" | "unavailable";

export type GoogleBlockResponse =
  | { available: true; block: ProviderGoogleBlock }
  /** "info Google sementara tidak tersedia": the page keeps its own content and the Maps link. */
  | { available: false; reason: PlacesUnavailableReason; googleMapsUri: string };

export interface PublicGoogleReview {
  rating?: number;
  text?: string;
  relativeTime?: string;
  publishTime?: string;
  /** Shown as Google gave it: name, photo and link (Google Maps attribution rules). */
  author: { name: string; uri?: string; photoUri?: string };
  googleMapsUri?: string;
}

export type GoogleReviewsResponse =
  | { available: true; reviews: PublicGoogleReview[] }
  | { available: false; reason: PlacesUnavailableReason };
