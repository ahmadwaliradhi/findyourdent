// Entry point of the `aggregates-recompute` Cloud Run Job: `node recompute-aggregates.ts`.
// Run once by hand after the spec 09 web deploy (infra/gcp/README.md); see
// server/aggregates-recompute.ts.
import { recomputeAggregates } from "./server/aggregates-recompute.ts";
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";

const firebase = initFirebaseAdmin();
if (!firebase) {
  logger.error("aggregates_recompute", { outcome: "firebase_not_configured" });
  process.exit(1);
}
const summary = await recomputeAggregates({ firestore: firebase.firestore, logger });
// Open Firestore channels would otherwise keep the job running until its timeout.
await firebase.firestore.terminate();
process.exit(summary.failed > 0 ? 1 : 0);
