// Feed card data shared by the server loader, /api/feed and the browser (spec 04).
// The Firestore read lives in server/feed.server.ts.
import type { AspectRatings, ProviderType, RegionRef } from "@findyourdent/contracts/firestore";

/** One feed card. Plain, serialisable data. */
export interface FeedItem {
  id: string;
  placeId: string;
  /** The Listed Provider's first-party name. */
  providerName: string;
  providerType: ProviderType;
  region: RegionRef;
  ratings: AspectRatings;
  excerpt: string;
  visitMonth: string;
  procedureCode?: string;
  pricePaidRupiah?: number;
  /** Kunjungan terbukti. */
  verifiedVisit: boolean;
  displayName: string;
}

export interface FeedPage {
  items: FeedItem[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}
