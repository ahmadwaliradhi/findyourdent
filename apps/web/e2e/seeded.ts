// Specs that need stored data (Listed Providers, Testimonies, an approved Claim) run
// against a second e2e server backed by the Firestore and Auth emulators, on the ports
// in firebase.e2e.json (playwright.config.ts starts it; the emulators need Java).
// `test` from here points `baseURL` at that server and seeds it from the test process.
// The emulators keep data for the whole run, so every seeded name is unique to its test.
import { randomUUID } from "node:crypto";
import { type ClaimDoc, COLLECTIONS } from "@findyourdent/contracts/firestore";
import { test as base, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import emulatorConfig from "../../../firebase.e2e.json" with { type: "json" };
import { APP_CHECK_HEADER } from "../app/lib/app-check.ts";

export { seedProvider, seedTestimony } from "../test/support/fixtures.ts";

export const SEEDED_PORT = 3101;
export const E2E_PROJECT_ID = "demo-findyourdent";
export const E2E_APP_CHECK_DEBUG_TOKEN = "e2e-app-check-debug-token";
const FIRESTORE_HOST = `127.0.0.1:${emulatorConfig.emulators.firestore.port}`;
const AUTH_HOST = `127.0.0.1:${emulatorConfig.emulators.auth.port}`;

export interface SeededOptions {
  /** The emulator-backed server's origin; playwright.config.ts sets it. */
  seededBaseURL: string;
}

function seedFirestore(): Firestore {
  // firebase-admin reads the emulator host when the Firestore client is created.
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  const app = getApps().find((a) => a.name === "e2e-seed") ?? initializeApp({ projectId: E2E_PROJECT_ID }, "e2e-seed");
  return getFirestore(app);
}

export const test = base.extend<{ firestore: Firestore; unique: string }, SeededOptions>({
  seededBaseURL: [`http://127.0.0.1:${SEEDED_PORT}`, { option: true, scope: "worker" }],
  baseURL: async ({ seededBaseURL }, use) => use(seededBaseURL),
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
  firestore: async ({}, use) => use(seedFirestore()),
  // A tag for this test's seeded names and ids, so runs on both projects never meet.
  // biome-ignore lint/correctness/noEmptyPattern: as above.
  unique: async ({}, use) => use(randomUUID().slice(0, 8)),
});

export { expect } from "@playwright/test";

/**
 * Signs the page in as `email` with Google, through the Auth emulator and /auth/session,
 * as the browser does after the Google pop-up. Returns the Firebase uid.
 */
export async function signIn(page: Page, email: string): Promise<string> {
  const googleIdToken = JSON.stringify({ sub: `google-${email}`, email, email_verified: true });
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        requestUri: "http://localhost",
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) throw new Error(`emulator sign-in failed: ${response.status} ${await response.text()}`);
  const { idToken, localId } = (await response.json()) as { idToken: string; localId: string };
  const session = await page.request.post("/auth/session", {
    data: { idToken },
    headers: { [APP_CHECK_HEADER]: E2E_APP_CHECK_DEBUG_TOKEN },
  });
  if (!session.ok()) throw new Error(`session failed: ${session.status()}`);
  return localId;
}

/** Marks `placeId` as claimed by `claimantUid` through an approved Claim, as the admin's approval leaves it. */
export async function seedApprovedClaim(firestore: Firestore, placeId: string, claimantUid: string): Promise<void> {
  const now = new Date();
  // Dates where ClaimDoc has Timestamps: firebase-admin stores either as a timestamp.
  const claim: Omit<ClaimDoc, "reviewedAt" | "createdAt" | "updatedAt"> &
    Record<"reviewedAt" | "createdAt" | "updatedAt", Date> = {
    placeId,
    claimantUid,
    role: "owner",
    contactPhone: "0812-0000-0000",
    status: "approved",
    reviewedBy: "admin.satu@example.com",
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await firestore.collection(COLLECTIONS.claims).add(claim);
  await firestore
    .collection(COLLECTIONS.providers)
    .doc(placeId)
    .update({ claimStatus: "claimed", claimId: ref.id, updatedAt: now });
}
