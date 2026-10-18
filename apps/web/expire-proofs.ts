// Entry point of the `proof-expiry` Cloud Run Job: `node expire-proofs.ts`.
// Cloud Scheduler runs it hourly (infra/gcp/deploy.sh); see server/proof-expiry.ts.
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";
import { expireProofs } from "./server/proof-expiry.ts";

const firebase = initFirebaseAdmin();
if (!firebase) {
  logger.error("proof_expiry", { outcome: "firebase_not_configured" });
  process.exit(1);
}
const summary = await expireProofs({ firestore: firebase.firestore, uploads: firebase.uploads, logger });
// Open Firestore channels would otherwise keep the job running until its timeout.
await firebase.firestore.terminate();
// A failed write or file delete fails the run, so it shows; a file left behind is the
// lifecycle rule's to delete.
process.exit(summary.failed + summary.expiredFileLeft > 0 ? 1 : 0);
