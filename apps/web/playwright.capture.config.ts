import { defineConfig, devices } from "@playwright/test";
import { AUTHOR_SESSION_PATH, DEPLOYED_BASE_URL } from "./e2e-deployed/env.ts";

// Demo video screen captures (issue #111): one clip per storyboard scene, recorded on the
// deployed site at phone width and saved to docs/submission/video/captures/.
// Needs what the deployed journeys need (playwright.deployed.config.ts), plus ffmpeg, and
// for scene 4 a real receipt: see e2e-capture/scenes.spec.ts.
//   pnpm --filter web capture:deployed
//   pnpm --filter web capture:deployed --grep "scene 2"
export default defineConfig({
  testDir: "./e2e-capture",
  globalSetup: "./e2e-deployed/global-setup.ts",
  outputDir: "test-results/capture",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 45_000 },
  reporter: "list",
  use: {
    baseURL: DEPLOYED_BASE_URL,
    locale: "id-ID",
    storageState: AUTHOR_SESSION_PATH,
    ...devices["Pixel 5"],
    viewport: { width: 360, height: 780 },
    // Twice the viewport, so the 2.75x phone screen stays sharp in a 1080p edit.
    video: { mode: "on", size: { width: 720, height: 1560 } },
    // Each step stays on screen long enough to follow.
    launchOptions: { slowMo: 150 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "capture-mobile-360" }],
});
