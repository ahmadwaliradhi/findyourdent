import { defineConfig, devices } from "@playwright/test";
import { E2E_APP_CHECK_DEBUG_TOKEN, E2E_PROJECT_ID, SEEDED_PORT, type SeededOptions } from "./e2e/seeded.ts";

const port = 3100;

// Both servers run with fake Places and agent adapters and no real Firebase.
const serverEnv = {
  AGENT_ADAPTER: "fake",
  PLACES_ADAPTER: "fake",
  APP_CHECK_DEBUG_TOKEN: E2E_APP_CHECK_DEBUG_TOKEN,
  // Every test shares the one debug token, so the per-browser hourly limits would run out mid-run.
  RATE_LIMIT_GUIDANCE_PER_HOUR: "1000",
  RATE_LIMIT_PLACES_PER_HOUR: "1000",
};

export default defineConfig<SeededOptions>({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Playwright defaults to en-US; an Indonesian phone sends id-ID.
    locale: "id-ID",
    trace: "retain-on-failure",
  },
  // Mobile-first: the smallest supported phone width (360 px) is the primary target.
  projects: [
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node server.ts",
      url: `http://127.0.0.1:${port}/health`,
      // No Firebase here: the browser sends the debug token in place of an App Check token.
      env: { PORT: String(port), ...serverEnv },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The same app against the Firestore and Auth emulators, for specs that seed data (e2e/seeded.ts).
      command: `firebase emulators:exec --config ../../firebase.e2e.json --project ${E2E_PROJECT_ID} --only firestore,auth "node server.ts"`,
      url: `http://127.0.0.1:${SEEDED_PORT}/health`,
      env: { PORT: String(SEEDED_PORT), ...serverEnv },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Ctrl-C lets the CLI stop its emulators; the default kill leaves the Firestore emulator (Java) holding its port.
      gracefulShutdown: { signal: "SIGINT", timeout: 15_000 },
    },
  ],
});
