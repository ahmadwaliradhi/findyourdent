// The public feed of published Testimonies (spec 04). First-party data only:
// no Places call, no Google data, never the author's uid.
import {
  type AspectRatings,
  COLLECTIONS,
  type ProviderDoc,
  type ProviderType,
  type RegionRef,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { FieldPath, type Firestore, Timestamp } from "firebase-admin/firestore";
import type { ListingFilters } from "~/lib/listing-filters";

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

/** A cursor that this module did not make, or that was damaged on the way. */
export class FeedCursorError extends Error {
  constructor() {
    super("invalid feed cursor");
  }
}

export const FEED_PAGE_SIZE = 10;
export const EXCERPT_LENGTH = 280;

/** Position after the last card of a page: its publish time and document id (the tie-breaker). */
export interface FeedPosition {
  seconds: number;
  nanoseconds: number;
  id: string;
}

const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CURSOR = /^(\d{1,12}):(\d{1,9}):(.+)$/;

/** Opaque to the browser: base64url of `seconds:nanoseconds:id`. */
export function encodeFeedCursor(position: FeedPosition): string {
  return Buffer.from(`${position.seconds}:${position.nanoseconds}:${position.id}`).toString("base64url");
}

export function decodeFeedCursor(cursor: string): FeedPosition | null {
  if (!cursor || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const match = CURSOR.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match) return null;
  const [, seconds, nanoseconds, id] = match as unknown as [string, string, string, string];
  if (Number(nanoseconds) >= 1e9 || !DOC_ID.test(id)) return null;
  return { seconds: Number(seconds), nanoseconds: Number(nanoseconds), id };
}

/** Whitespace collapsed, then cut on a word boundary with an ellipsis when longer than `max`. */
export function excerpt(text: string, max = EXCERPT_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max + 1);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : flat.slice(0, max);
  return `${cut.trimEnd()}…`;
}

/**
 * One page of published Testimonies, newest first, matching the filters.
 * Throws FeedCursorError for a cursor it did not make.
 */
export async function loadFeedPage(
  firestore: Firestore,
  filters: ListingFilters,
  cursor?: string,
  pageSize = FEED_PAGE_SIZE,
): Promise<FeedPage> {
  const after = cursor ? decodeFeedCursor(cursor) : null;
  if (cursor && !after) throw new FeedCursorError();

  // Only `published`: removed, hidden, held, deleted and unmoderated Testimonies never show.
  let query = firestore.collection(COLLECTIONS.testimonies).where("status", "==", "published");
  if (filters.provinceCode) query = query.where("region.provinceCode", "==", filters.provinceCode);
  if (filters.regencyCode) query = query.where("region.regencyCode", "==", filters.regencyCode);
  if (filters.districtCode) query = query.where("region.districtCode", "==", filters.districtCode);
  if (filters.procedureCode) query = query.where("procedureCode", "==", filters.procedureCode);
  if (filters.providerType) query = query.where("providerType", "==", filters.providerType);
  if (filters.verifiedOnly) query = query.where("verifiedVisit", "==", true);
  query = query.orderBy("publishedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (after) query = query.startAfter(new Timestamp(after.seconds, after.nanoseconds), after.id);

  // One extra document tells whether another page exists.
  const snapshot = await query.limit(pageSize + 1).get();
  const docs = snapshot.docs.slice(0, pageSize);
  const last = docs.at(-1);
  const lastPublishedAt = last?.get("publishedAt") as Timestamp | undefined;
  const nextCursor =
    snapshot.docs.length > pageSize && last && lastPublishedAt
      ? encodeFeedCursor({ seconds: lastPublishedAt.seconds, nanoseconds: lastPublishedAt.nanoseconds, id: last.id })
      : null;

  const placeIds = [...new Set(docs.map((doc) => doc.get("placeId") as string))];
  const providerSnapshots = placeIds.length
    ? await firestore.getAll(...placeIds.map((id) => firestore.collection(COLLECTIONS.providers).doc(id)))
    : [];
  const providers = new Map(
    providerSnapshots.filter((s) => s.exists).map((s) => [s.id, s.data() as ProviderDoc] as const),
  );

  const items: FeedItem[] = [];
  for (const doc of docs) {
    const testimony = doc.data() as TestimonyDoc;
    const provider = providers.get(testimony.placeId);
    // Every published Testimony has a Listed Provider; skip rather than show a nameless card.
    if (!provider) continue;
    items.push(toFeedItem(doc.id, testimony, provider));
  }
  return { items, nextCursor };
}

/** Picks public fields only, so the author's uid and any later field cannot leak by accident. */
function toFeedItem(id: string, testimony: TestimonyDoc, provider: ProviderDoc): FeedItem {
  const item: FeedItem = {
    id,
    placeId: testimony.placeId,
    providerName: provider.name,
    providerType: provider.providerType,
    region: {
      provinceCode: provider.region.provinceCode,
      regencyCode: provider.region.regencyCode,
      ...(provider.region.districtCode ? { districtCode: provider.region.districtCode } : {}),
    },
    ratings: {
      service: testimony.ratings.service,
      hygiene: testimony.ratings.hygiene,
      materialsEquipment: testimony.ratings.materialsEquipment,
    },
    excerpt: excerpt(testimony.text),
    visitMonth: testimony.visitMonth,
    verifiedVisit: testimony.verifiedVisit === true,
    displayName: testimony.displayName,
  };
  if (testimony.procedureCode) item.procedureCode = testimony.procedureCode;
  if (typeof testimony.pricePaidRupiah === "number") item.pricePaidRupiah = testimony.pricePaidRupiah;
  return item;
}
