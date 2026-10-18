// Before the deployed journeys: an App Check debug token for the browser, and saved
// sessions from E2E_SESSION_COOKIE and E2E_ADMIN_SESSION_COOKIE when given (session.ts checks them).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ADMIN_SESSION_PATH,
  APP_CHECK_DEBUG_TOKEN_ENV,
  AUTHOR_SESSION_PATH,
  DEPLOYED_BASE_URL,
  GCP_PROJECT_ID,
} from "./env.ts";

/** A `__session` value copied from a signed-in browser, in place of the login script. */
function writeSession(value: string, path: string) {
  const state = {
    cookies: [
      {
        name: "__session",
        value,
        domain: new URL(DEPLOYED_BASE_URL).hostname,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

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
  if (process.env.E2E_SESSION_COOKIE) writeSession(process.env.E2E_SESSION_COOKIE, AUTHOR_SESSION_PATH);
  if (process.env.E2E_ADMIN_SESSION_COOKIE) writeSession(process.env.E2E_ADMIN_SESSION_COOKIE, ADMIN_SESSION_PATH);
  // Workers inherit the environment global setup leaves behind.
  process.env[APP_CHECK_DEBUG_TOKEN_ENV] ??= appCheckDebugToken();
}
