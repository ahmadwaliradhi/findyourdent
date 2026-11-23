// Entry point of the one-off `aggregates-recompute` Cloud Run Job:
// `node recompute-aggregates.ts`. Run once at the spec 09 release (infra/gcp/README.md);
// see server/aggregates-recompute.ts. Safe to run again: it only writes what changed.
import { recomputeAllAggregates } from "./server/aggregates-recompute.ts";
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";

const firebase = initFirebaseAdmin();
if (!firebase) {
  logger.error("aggregates_recompute", { outcome: "firebase_not_configured" });
  process.exit(1);
}
await recomputeAllAggregates({ firestore: firebase.firestore, logger });
// Open Firestore channels would otherwise keep the job running until its timeout.
await firebase.firestore.terminate();
process.exit(0);
