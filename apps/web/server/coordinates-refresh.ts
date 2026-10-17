/**
 * The coordinate refresh job (spec 02, ADR-0005). Google's terms let us keep a
 * Listed Provider's coordinates for 30 days, so each one is refreshed with an
 * Essentials Place Details call once it is 25 days old, and deleted once it could
 * not be refreshed and would be older than 30 days by the next daily run.
 */
import {
  COLLECTIONS,
  type ProviderDoc,
  type StoredLocation,
  type Timestamp as StoredTimestamp,
} from "@findyourdent/contracts/firestore";
import { type DocumentReference, FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { COORDINATES_DAILY_CAP, type LatLng, type PlacesAdapter } from "./adapters/places.ts";
import type { Logger } from "./logger.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Old enough to refresh: five days of daily runs before the 30-day limit. */
export const REFRESH_AFTER_DAYS = 25;
/** Google's limit. The job runs daily, so it deletes what would pass it before tomorrow. */
export const KEEP_AT_MOST_DAYS = 30;
/** Coordinates calls a day left for new Listed Providers (server/testimonies.server.ts). */
const NEW_LISTED_PROVIDER_RESERVE = 3;
/** Calls a run may make under the shared `coordinates` daily cap. */
export const REFRESH_BATCH_SIZE = COORDINATES_DAILY_CAP - NEW_LISTED_PROVIDER_RESERVE;

export interface RefreshCoordinatesOptions {
  firestore: Firestore;
  places: PlacesAdapter;
  logger: Logger;
  /** Epoch milliseconds. */
  now?: () => number;
}

export interface RefreshSummary {
  refreshed: number;
  deleted: number;
  /** Due, but not refreshed this run; still within 30 days tomorrow, so left for the next run. */
  left: number;
  /** Firestore refused a write; the next run tries again. */
  failed: number;
}

/**
 * One run, meant to be daily: each Listed Provider then comes up once a month. At
 * REFRESH_BATCH_SIZE a day it keeps up with about 175 Listed Providers (7 a day over
 * the 25 days before a refresh is overdue); past that, the oldest lose coordinates.
 */
export async function refreshCoordinates({
  firestore,
  places,
  logger,
  now = Date.now,
}: RefreshCoordinatesOptions): Promise<RefreshSummary> {
  const nowMs = now();
  const providers = await firestore.collection(COLLECTIONS.providers).get();
  const due = providers.docs
    .map((doc) => ({ ref: doc.ref, fetchedAt: (doc.data() as ProviderDoc).location?.fetchedAt ?? null }))
    // A Listed Provider created past the coordinates cap has none yet: it goes last,
    // after every one that has coordinates to lose.
    .map((entry) => ({ ...entry, ageMs: entry.fetchedAt ? nowMs - entry.fetchedAt.toMillis() : null }))
    .filter(({ ageMs }) => ageMs === null || ageMs >= REFRESH_AFTER_DAYS * DAY_MS)
    .sort((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1));

  const summary: RefreshSummary = { refreshed: 0, deleted: 0, left: 0, failed: 0 };
  let callsLeft = REFRESH_BATCH_SIZE;
  for (const { ref, fetchedAt, ageMs } of due) {
    let location: LatLng | null = null;
    if (callsLeft > 0) {
      callsLeft -= 1;
      const result = await places.getCoordinates(ref.id);
      if (result.ok) location = result.location;
      else if (result.reason === "cap_reached") callsLeft = 0;
    }
    const expiring = ageMs !== null && ageMs + DAY_MS > KEEP_AT_MOST_DAYS * DAY_MS;
    if (!location && !expiring) {
      summary.left += 1;
      continue;
    }
    try {
      const fresh: StoredLocation | null = location ? { ...location, fetchedAt: Timestamp.fromMillis(nowMs) } : null;
      if (await replaceIfUnchanged(firestore, ref, fetchedAt, fresh)) summary[fresh ? "refreshed" : "deleted"] += 1;
    } catch {
      summary.failed += 1;
    }
  }
  logger.info("coordinates_refresh", { outcome: "done", ...summary });
  return summary;
}

/**
 * Writes `fresh` (or deletes the coordinates when null) only if the Provider still
 * has the coordinates this run read: a Listed Provider written meanwhile keeps its
 * newer ones, and one that went away is skipped. Returns whether it wrote.
 */
async function replaceIfUnchanged(
  firestore: Firestore,
  ref: DocumentReference,
  fetchedAt: StoredTimestamp | null,
  fresh: StoredLocation | null,
): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const current = (snapshot.data() as ProviderDoc).location?.fetchedAt ?? null;
    if ((current?.toMillis() ?? null) !== (fetchedAt?.toMillis() ?? null)) return false;
    tx.update(ref, { location: fresh ?? FieldValue.delete() });
    return true;
  });
}
