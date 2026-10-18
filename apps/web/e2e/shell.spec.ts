import { expect, type Page, test } from "@playwright/test";

// The shell every page shares (spec 08): header, mobile pill nav, language switch, footer.

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("switching the language keeps the current page and query, and flips lang", async ({ page }) => {
    await page.goto("/ceritakan?placeId=sample-klinik-senyum");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");

    const languages = page.getByRole("group", { name: "Pilih bahasa" });
    await expect(languages.locator('[aria-current="true"]')).toHaveAttribute("lang", "id");
    await languages.getByRole("button", { name: "Ganti bahasa ke English" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(new URL(page.url()).pathname).toBe("/ceritakan");
    expect(new URL(page.url()).search).toBe("?placeId=sample-klinik-senyum");

    const switched = page.getByRole("group", { name: "Choose language" });
    await expect(switched.locator('[aria-current="true"]')).toHaveAttribute("lang", "en");
    // The current language is marked, not offered: only the other one submits.
    await expect(switched.getByRole("button")).toHaveCount(1);
    await expect(switched.getByRole("button", { name: "Switch language to Bahasa Indonesia" })).toBeVisible();
  });
});

test("every page has a skip link to main, a nav marking the current page, and a footer", async ({ page }) => {
  await page.goto("/ceritakan");

  const skip = page.getByRole("link", { name: "Langsung ke konten" });
  await expect(skip).toHaveAttribute("href", "#main");
  await expect(page.getByRole("main")).toHaveAttribute("id", "main");

  // Desktop shows the header nav, phones the pill row; whichever is visible marks the current page.
  const nav = page.getByRole("navigation", { name: "Utama" });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Panduan" })).toHaveAttribute("href", "/");
  await expect(nav.getByRole("link", { name: "Direktori" })).toHaveAttribute("href", "/direktori");
  await expect(nav.getByRole("link", { name: "Testimoni saya" })).toHaveAttribute("href", "/testimoni-saya");

  const write = page.getByRole("banner").getByRole("link", { name: "Ceritakan pengalamanmu" });
  await expect(write).toHaveCount(1);
  await expect(write).toHaveAttribute("href", "/ceritakan");

  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("bukan diagnosis atau resep obat");
  await expect(footer.getByRole("link", { name: "Direktori" })).toHaveAttribute("href", "/direktori");
  await expect(footer.getByRole("link", { name: "business@findyourdent.com" })).toHaveAttribute(
    "href",
    "mailto:business@findyourdent.com",
  );

  await page.goto("/direktori");
  await expect(
    page.getByRole("navigation", { name: "Utama" }).getByRole("link", { name: "Direktori" }),
  ).toHaveAttribute("aria-current", "page");
});

test("each language option is at least 44px wide and tall", async ({ page }) => {
  await page.goto("/");
  const languages = page.getByRole("group", { name: "Pilih bahasa" });
  for (const option of [languages.locator('[aria-current="true"]'), languages.getByRole("button")]) {
    const box = await option.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

for (const path of ["/", "/ceritakan", "/tempat/sample-klinik-senyum", "/signin"]) {
  test(`${path} does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    await noHorizontalScroll(page);
  });
}
