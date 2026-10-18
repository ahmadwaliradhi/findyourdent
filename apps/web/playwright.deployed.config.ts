import { defineConfig, devices } from "@playwright/test";
import { AUTHOR_SESSION_PATH, DEPLOYED_BASE_URL } from "./e2e-deployed/env.ts";

// The three journeys of spec 02 and spec 03 against the deployed site: real Gemini,
// Places, Firestore and App Check. Save two Google sessions once (they last 5 days):
// `pnpm --filter web e2e:deployed:login` for the author and `e2e:deployed:login:admin`
// for an allowlisted admin. Then `E2E_PLACE_ID=<place id> pnpm --filter web test:e2e:deployed`.
// The journeys share one account and one place, so they run one at a time.
export default defineConfig({
  testDir: "./e2e-deployed",
  globalSetup: "./e2e-deployed/global-setup.ts",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Gemini and Places answer in seconds, not milliseconds.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/deployed.json" }]],
  use: {
    baseURL: DEPLOYED_BASE_URL,
    locale: "id-ID",
    storageState: AUTHOR_SESSION_PATH,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "deployed-mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } } }],
});
