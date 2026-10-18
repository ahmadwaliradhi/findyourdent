import { fileURLToPath } from "node:url";

/** The deployed site under test: production by default, or a Cloud Run tag or Hosting channel URL. */
export const DEPLOYED_BASE_URL = (process.env.E2E_BASE_URL ?? "https://findyourdent.com").replace(/\/$/, "");

// Google sessions saved by login.ts (gitignored; each cookie lasts 5 days). The author and
// the admin are separate accounts: each account may post 5 Testimonies a day, and a full
// run posts 3, so the admin's own quota is never spent on writing.
/** The Patient who writes the Testimonies: any Google account. `e2e:deployed:login` */
export const AUTHOR_SESSION_PATH = fileURLToPath(new URL("./.auth/author.json", import.meta.url));
/** An account on the admin allowlist. `e2e:deployed:login:admin` */
export const ADMIN_SESSION_PATH = fileURLToPath(new URL("./.auth/admin.json", import.meta.url));

/**
 * The Listed Provider the Testimony journeys write about. Pick one the signed-in
 * account has really visited: each run publishes there for a few seconds, then deletes.
 */
export const PLACE_ID_ENV = "E2E_PLACE_ID";

/** Set by global-setup.ts from the `app-check-debug-token` secret, for the browser's App Check SDK. */
export const APP_CHECK_DEBUG_TOKEN_ENV = "E2E_APP_CHECK_DEBUG_TOKEN";

export const GCP_PROJECT_ID = process.env.PROJECT_ID ?? "findyourdent";
