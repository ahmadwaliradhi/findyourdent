import { expect, type Page } from "@playwright/test";

/** Every request the page makes to the given API path, counted as they leave. */
export function countRequests(page: Page, path: string) {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path) seen.push(request.url());
  });
  return seen;
}

/** Every post to the home Guidance action: a plain form post, or the router's /_root.data fetch. */
export function countGuidanceSubmits(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === "POST" && (pathname === "/" || pathname === "/_root.data")) seen.push(request.url());
  });
  return seen;
}

export async function guidanceAndShortlist(page: Page) {
  await page.goto("/");
  await page.getByLabel("Ceritakan keluhan gigi Anda").fill("Gigi geraham nyut-nyutan sejak tiga hari");
  await page.getByRole("button", { name: "Lihat panduan" }).click();
  await expect(page.getByText("Panduan untuk keluhan Anda")).toBeVisible();

  await page.getByRole("button", { name: "Lihat dokter gigi terdekat" }).click();
  await page.getByLabel("Atau tulis area Anda").fill("Gubeng, Surabaya");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toBeVisible();
}

/** The folded "Filter" section over a listing (the feed, and the Directory below desktop width). */
export function filterSection(page: Page) {
  return page.locator("details", { has: page.locator("summary", { hasText: "Filter" }) });
}

/** Opens the Filter section where it is folded; on the desktop Directory it is already open. */
export async function openFilters(page: Page) {
  const summary = filterSection(page).locator("summary");
  if (await summary.isVisible()) await summary.click();
}
