/**
 * The coordinate refresh job (spec 02, ADR-0005). Google's terms let us keep a
 * Listed Provider's coordinates for 30 days, so each one is refreshed with an
 * Essentials Place Details call once it is 25 days old, and deleted once it is
 * older than 30 days and could not be refreshed.
 */
import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import type { PlacesAdapter } from "./adapters/places.ts";
import type { Logger } from "./logger.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Old enough to refresh: five days of daily runs before the 30-day limit. */
export const REFRESH_AFTER_DAYS = 25;
/** Google's limit: older coordinates that could not be refreshed are deleted. */
export const KEEP_AT_MOST_DAYS = 30;
/**
 * Calls a run may make: coordinates share the 10-a-day `coordinates` cap with new
 * Listed Providers (COORDINATES_DAILY_CAP), so a daily run leaves them three.
 */
export const REFRESH_BATCH_SIZE = 7;

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
  /** Due, but not refreshed this run; still within 30 days, so left for the next run. */
  left: number;
}

/** One run, meant to be daily: each Listed Provider then comes up once a month. */
export async function refreshCoordinates({
  firestore,
  places,
  logger,
  now = Date.now,
}: RefreshCoordinatesOptions): Promise<RefreshSummary> {
  const nowMs = now();
  const providers = await firestore.collection(COLLECTIONS.providers).get();
  const due = providers.docs
    .map((doc) => {
      const { location } = doc.data() as ProviderDoc;
      // A Listed Provider created past the coordinates cap has none yet: it goes last,
      // after every one that has coordinates to lose.
      const ageMs = location ? nowMs - location.fetchedAt.toMillis() : null;
      return { doc, ageMs };
    })
    .filter(({ ageMs }) => ageMs === null || ageMs >= REFRESH_AFTER_DAYS * DAY_MS)
    .sort((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1));

  const summary: RefreshSummary = { refreshed: 0, deleted: 0, left: 0 };
  let calls = 0;
  let capReached = false;
  for (const { doc, ageMs } of due) {
    if (!capReached && calls < REFRESH_BATCH_SIZE) {
      calls += 1;
      const result = await places.getCoordinates(doc.id);
      if (result.ok) {
        await doc.ref.update({ location: { ...result.location, fetchedAt: Timestamp.fromMillis(nowMs) } });
        summary.refreshed += 1;
        continue;
      }
      capReached = result.reason === "cap_reached";
    }
    if (ageMs !== null && ageMs > KEEP_AT_MOST_DAYS * DAY_MS) {
      await doc.ref.update({ location: FieldValue.delete() });
      summary.deleted += 1;
    } else {
      summary.left += 1;
    }
  }
  logger.info("coordinates_refresh", { outcome: capReached ? "cap_reached" : "done", ...summary });
  return summary;
}
