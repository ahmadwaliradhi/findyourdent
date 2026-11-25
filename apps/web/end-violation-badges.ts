// Entry point of the `violation-badge-expiry` Cloud Run Job: `node end-violation-badges.ts`.
// Cloud Scheduler runs it daily (infra/gcp/deploy.sh); see server/violation-badge-expiry.ts.
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";
import { endExpiredViolationBadges } from "./server/violation-badge-expiry.ts";

const firebase = initFirebaseAdmin();
if (!firebase) {
  logger.error("violation_badge_expiry", { outcome: "firebase_not_configured" });
  process.exit(1);
}
const summary = await endExpiredViolationBadges({ firestore: firebase.firestore, logger });
// Open Firestore channels would otherwise keep the job running until its timeout.
await firebase.firestore.terminate();
process.exit(summary.failed > 0 ? 1 : 0);
