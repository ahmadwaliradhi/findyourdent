// Before the deployed journeys: the App Check debug token the browsers send in place of reCAPTCHA.
import { execFileSync } from "node:child_process";
import { APP_CHECK_DEBUG_TOKEN_ENV, GCP_PROJECT_ID } from "./env.ts";

/** The registered App Check debug token (infra/gcp/README.md), read with the caller's gcloud login. */
function appCheckDebugToken(): string {
  try {
    return execFileSync(
      "gcloud",
      ["secrets", "versions", "access", "latest", "--secret=app-check-debug-token", `--project=${GCP_PROJECT_ID}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    throw new Error(`Could not read the app-check-debug-token secret. Run \`gcloud auth login\` on ${GCP_PROJECT_ID}.`);
  }
}

export default async function globalSetup() {
  // Workers inherit the environment global setup leaves behind.
  process.env[APP_CHECK_DEBUG_TOKEN_ENV] ??= appCheckDebugToken();
}
