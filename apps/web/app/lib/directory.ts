// Directory types, URL parameters and parsers shared by the server loader and
// the browser (spec 04). The Firestore read lives in server/directory.server.ts.
import type { AspectRatings, ProviderDoc, ProviderType, RegionRef } from "@findyourdent/contracts/firestore";
import type { LatLng } from "~/lib/geo";

/** URL value of each sort, Indonesian for readable links. "jarak" is sorted in the browser. */
export const DIRECTORY_SORTS = ["testimoni", "skor", "jarak"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];
export const DEFAULT_DIRECTORY_SORT: DirectorySort = "testimoni";

/** URL parameters owned by the directory, next to the shared FILTER_PARAMS. */
export const DIRECTORY_PARAMS = { query: "q", sort: "urut" } as const;

/** Rows shown on one page. There is no pagination: narrow with filters or the name search. */
export const DIRECTORY_ROW_LIMIT = 200;
const MAX_QUERY_LENGTH = 100;

export interface DirectoryRow {
  placeId: string;
  name: string;
  region: RegionRef;
  providerType: ProviderType;
  providerTypeSource: ProviderDoc["providerTypeSource"];
  averages: AspectRatings | null;
  testimonyCount: number;
  verifiedVisitCount: number;
  claimed: boolean;
  /** Shrunk aspect score shown on the row (lib/scores.ts); null without an average (the score sort then uses the overall mean). */
  score: number | null;
  /** Stored coordinates only (never their fetch date), for distance computed in the browser. */
  location: LatLng | null;
}

export function parseDirectorySort(value: string | null): DirectorySort {
  return (DIRECTORY_SORTS as readonly string[]).includes(value ?? "")
    ? (value as DirectorySort)
    : DEFAULT_DIRECTORY_SORT;
}

export function parseDirectoryQuery(value: string | null): string {
  return (value ?? "").trim().slice(0, MAX_QUERY_LENGTH);
}
