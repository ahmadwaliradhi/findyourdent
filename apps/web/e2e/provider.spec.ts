import { expect, type Page, test } from "@playwright/test";
import { countRequests, guidanceAndShortlist } from "./support";

// Runs with PLACES_ADAPTER=fake (playwright.config.ts): made-up sample places, a
// Google block and one review for each, and a used-up cap for any other place id.

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("Shortlist to Provider page: the Google block loads with attribution, and Google Reviews only on a tap", async ({
  page,
}) => {
  const reviews = countRequests(page, "/api/providers/sample-klinik-senyum/reviews");
  await guidanceAndShortlist(page);

  const card = page.locator('[data-place-id="sample-klinik-senyum"]');
  await card.getByRole("link", { name: "Lihat halaman" }).click();

  await expect(page).toHaveURL(/\/tempat\/sample-klinik-senyum$/);
  // Not a Listed Provider (no Firestore here): the heading comes from the Google block.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Klinik Gigi Senyum Contoh");
  await expect(page.getByText("Jl. Contoh No. 1, Surabaya")).toBeVisible();
  await expect(page.getByText("Rating Google 4,6 dari 12 ulasan")).toBeVisible();
  await expect(page.getByText("Sumber: Google Maps").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Telepon 0812-0000-0001/ })).toHaveAttribute("href", "tel:081200000001");
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/6281200000001");
  await expect(page.getByRole("link", { name: "Buka di Google Maps" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  expect(reviews).toEqual([]);

  await page.getByRole("button", { name: "Lihat ulasan Google" }).click();

  const review = page.getByTestId("google-reviews");
  await expect(review.getByRole("link", { name: "Pengulas Contoh" })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/contrib/sample",
  );
  await expect(review.locator('img[src="/favicon.svg"]')).toBeVisible();
  await expect(review.getByText("dokternya sabar dan ruangannya bersih")).toBeVisible();
  await expect(review.getByText("Sumber: Google Maps")).toBeVisible();
  expect(reviews).toHaveLength(1);
  await noHorizontalScroll(page);
});

test("going back from a Provider page keeps the Guidance and the Shortlist, without a new search", async ({ page }) => {
  const searches = countRequests(page, "/api/shortlist");
  await guidanceAndShortlist(page);
  expect(searches).toHaveLength(1);

  await page.locator('[data-place-id="sample-drg-ani"]').getByRole("link", { name: "Lihat halaman" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("drg. Ani Contoh");

  await page.goBack();

  await expect(page.getByText("Panduan untuk keluhan Anda")).toBeVisible();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toBeVisible();
  await expect(page.getByText("drg. Ani Contoh")).toBeVisible();
  expect(searches).toHaveLength(1);
  // Kept in memory only: nothing from Google lands in browser storage or history state.
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...sessionStorage }, { ...localStorage }, window.history.state]),
  );
  expect(stored).not.toContain("Contoh");
});

test("a new complaint does not bring back the previous Shortlist", async ({ page }) => {
  await guidanceAndShortlist(page);

  await page.getByLabel("Ceritakan keluhan gigi Anda").fill("Gusi berdarah saat sikat gigi");
  await page.getByRole("button", { name: "Lihat panduan" }).click();

  await expect(page.getByRole("button", { name: "Lihat dokter gigi terdekat" })).toBeVisible();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toHaveCount(0);
});

test("Shortlist cards offer Google Reviews in place", async ({ page }) => {
  await guidanceAndShortlist(page);

  const card = page.locator('[data-place-id="sample-klinik-senyum"]');
  await card.getByRole("button", { name: "Lihat ulasan Google" }).click();

  await expect(card.getByRole("link", { name: "Pengulas Contoh" })).toBeVisible();
  await noHorizontalScroll(page);
});

test("when the Google block cap is used up, the page keeps the Maps link and says Google info is unavailable", async ({
  page,
}) => {
  await page.goto("/tempat/place-over-the-cap");

  await expect(page.getByText("Info Google sementara tidak tersedia.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka di Google Maps" })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=dokter%20gigi&query_place_id=place-over-the-cap",
  );
  await noHorizontalScroll(page);
});
