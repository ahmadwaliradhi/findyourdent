// Entry point of the `coordinates-refresh` Cloud Run Job: `node refresh-coordinates.ts`.
// Cloud Scheduler runs it daily (infra/gcp/deploy.sh); see server/coordinates-refresh.ts.
import { createGooglePlacesAdapter } from "./server/adapters/places.ts";
import { refreshCoordinates } from "./server/coordinates-refresh.ts";
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";
import { createFirestoreDailyQuota } from "./server/quota.ts";

const firebase = initFirebaseAdmin();
// Always the real Places adapter: a fake would find nothing and delete coordinates
// instead of refreshing them, or write made-up ones.
const apiKey = process.env.PLACES_API_KEY;
if (!firebase || !apiKey) {
  logger.error("coordinates_refresh", { outcome: firebase ? "places_api_key_missing" : "firebase_not_configured" });
  process.exit(1);
}
const summary = await refreshCoordinates({
  firestore: firebase.firestore,
  places: createGooglePlacesAdapter({ apiKey, quota: createFirestoreDailyQuota(firebase.firestore) }),
  logger,
});
// Open Firestore channels would otherwise keep the job running until its timeout.
await firebase.firestore.terminate();
process.exit(summary.failed > 0 ? 1 : 0);
