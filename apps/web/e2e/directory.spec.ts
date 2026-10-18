import { expect, test } from "@playwright/test";

// The Directory (spec 04, redesigned in spec 08): filters in a sidebar, name search and
// sort above the results. The e2e server has no Firestore, so every search comes back empty.

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("name search, sort and filters go out in one request", async ({ page }) => {
    await page.goto("/direktori");
    await page.getByLabel("Cari nama tempat").fill("Senyum");
    await page.getByLabel("Urutkan").selectOption({ label: "Skor tertinggi" });
    await page.getByLabel("Hanya Kunjungan terbukti").check();
    await page.getByRole("button", { name: "Terapkan" }).click();

    await expect(page).toHaveURL(/\/direktori\?/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe("Senyum");
    expect(params.get("urut")).toBe("skor");
    expect(params.get("terbukti")).toBe("1");
    await expect(page.getByLabel("Cari nama tempat")).toHaveValue("Senyum");
    await expect(page.getByLabel("Urutkan")).toHaveValue("skor");
  });

  test("Enter in the name search submits it", async ({ page }) => {
    await page.goto("/direktori?urut=skor");
    await page.getByLabel("Cari nama tempat").fill("Pelita");
    await page.getByLabel("Cari nama tempat").press("Enter");

    await expect(page).toHaveURL(/q=Pelita/);
    expect(new URL(page.url()).searchParams.get("urut")).toBe("skor");
  });
});

test("empty results show the message and the share button", async ({ page }) => {
  await page.goto("/direktori?q=tidak-ada");
  const empty = page.getByTestId("directory-empty");
  await expect(empty.getByRole("heading", { name: "Belum ada tempat yang cocok" })).toBeVisible();
  await expect(empty.getByRole("link", { name: "Ceritakan pengalamanmu" })).toHaveAttribute("href", "/ceritakan");
});

test("the filters are labelled by a visible heading", async ({ page }) => {
  await page.goto("/direktori");
  await expect(page.getByRole("form", { name: "Saring" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saring" })).toBeVisible();
});

test("/direktori does not scroll sideways", async ({ page }) => {
  await page.goto("/direktori");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
