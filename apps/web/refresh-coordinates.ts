// Entry point of the `coordinates-refresh` Cloud Run Job: `node refresh-coordinates.ts`.
// Cloud Scheduler runs it daily (infra/gcp/deploy.sh); see server/coordinates-refresh.ts.
import { placesAdapter } from "./server/context.ts";
import { refreshCoordinates } from "./server/coordinates-refresh.ts";
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";

const firebase = initFirebaseAdmin();
if (!firebase) {
  logger.error("coordinates_refresh", { outcome: "firebase_not_configured" });
  process.exit(1);
}
if (!process.env.PLACES_API_KEY) {
  // Without a key the adapter is a fake that finds nothing, which would delete every
  // coordinate older than 30 days instead of refreshing it.
  logger.error("coordinates_refresh", { outcome: "places_api_key_missing" });
  process.exit(1);
}
await refreshCoordinates({
  firestore: firebase.firestore,
  places: placesAdapter(process.env, firebase.firestore),
  logger,
});
