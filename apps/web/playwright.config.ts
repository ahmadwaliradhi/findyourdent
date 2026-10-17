import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
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
  webServer: {
    command: "node server.ts",
    url: `http://127.0.0.1:${port}/healthz`,
    env: { PORT: String(port), AGENT_ADAPTER: "fake" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
