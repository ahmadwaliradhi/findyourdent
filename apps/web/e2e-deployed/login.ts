// Opens the deployed sign-in page in a visible Chrome window. Sign in with Google by
// hand; the session cookie is then saved for the deployed journeys. Deployed sign-in
// accepts only real Google accounts, so the tests cannot sign themselves in.
//
//   pnpm --filter web e2e:deployed:login         # the author: any Google account
//   pnpm --filter web e2e:deployed:login:admin   # an account on the admin allowlist
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";
import { ADMIN_SESSION_PATH, AUTHOR_SESSION_PATH, DEPLOYED_BASE_URL } from "./env.ts";

const admin = process.argv[2] === "admin";
const statePath = admin ? ADMIN_SESSION_PATH : AUTHOR_SESSION_PATH;

// Google refuses sign-in from browsers that announce automation; installed Chrome without that flag is accepted.
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({ locale: "id-ID" });
const page = await context.newPage();
await page.goto(`${DEPLOYED_BASE_URL}/signin?redirectTo=/testimoni-saya`);
console.log(
  `Sign in with ${admin ? "an allowlisted admin" : "the author's"} Google account in the browser window (5 minutes)...`,
);
await page.waitForURL((url) => url.pathname === "/testimoni-saya", { timeout: 5 * 60_000 });

mkdirSync(dirname(statePath), { recursive: true });
await context.storageState({ path: statePath });
console.log(`Session saved to ${statePath}. It lasts 5 days.`);
await browser.close();
