// Entry point of the `proof-expiry` Cloud Run Job: `node expire-proofs.ts`.
// Cloud Scheduler runs it daily (infra/gcp/deploy.sh); see server/proof-expiry.ts.
import { initFirebaseAdmin } from "./server/firebase.ts";
import { logger } from "./server/logger.ts";
import { expirePendingProofs } from "./server/proof-expiry.ts";

const firebase = initFirebaseAdmin();
if (!firebase) {
  logger.error("proof_expiry", { outcome: "firebase_not_configured" });
  process.exit(1);
}
const summary = await expirePendingProofs({ firestore: firebase.firestore, uploads: firebase.uploads, logger });
// Open Firestore channels would otherwise keep the job running until its timeout.
await firebase.firestore.terminate();
process.exit(summary.failed > 0 ? 1 : 0);
