import type { AspectRatings, ProcedureCode, ProviderType } from "@findyourdent/contracts/firestore";
import type { PriceSignal } from "~/lib/shortlist";

// What the Provider page loader and its two Google routes return
// (app/server/provider.server.ts), shared with the page.

/** A published Testimony as the Provider page shows it. Never carries the author's uid. */
export interface PublicTestimony {
  id: string;
  displayName: string;
  ratings: AspectRatings;
  text: string;
  visitMonth: string;
  procedureCode?: ProcedureCode;
  pricePaidRupiah?: number;
  verifiedVisit: boolean;
  /** The claimed Provider's published reply. */
  reply?: string;
}

/** Owner-entered facts from an approved Claim, shown only once moderation published them. */
export interface OwnerFacts {
  address?: string;
  phone?: string;
  whatsappUri?: string;
  website?: string;
  openingHours?: string;
}

/** FindYourDent's own content for one place_id, rendered on the server. */
export interface ProviderPageData {
  placeId: string;
  /** A Listed Provider: indexable, with a first-party name. Otherwise the page is noindex. */
  listed: boolean;
  name?: string;
  /** "Kota Surabaya, Jawa Timur". */
  regionName?: string;
  providerType?: ProviderType;
  providerTypeSource?: "inferred" | "claimed";
  claimed: boolean;
  testimonies: { count: number; verifiedVisitCount: number; averages?: AspectRatings };
  testimonyList: PublicTestimony[];
  /** Median price paid (two or more) and the owner's Price List, each with its source and date. */
  priceSignals: PriceSignal[];
  owner?: OwnerFacts;
  /** Built without an API call, so the page always links to Google Maps. */
  googleMapsUri: string;
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
