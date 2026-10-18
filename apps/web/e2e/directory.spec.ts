import { expect, test } from "@playwright/test";
import { test as seeded, seedProvider } from "./seeded";
import { filterSection, openFilters } from "./support";

// The Directory (spec 04, redesigned in spec 08): filters in a sidebar, name search and
// sort above the results on desktop; below it, all three fold under one "Filter" row.
// The e2e server has no Firestore, so every search comes back empty.

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("name search, sort and filters go out in one request", async ({ page }) => {
    await page.goto("/direktori");
    await openFilters(page);
    await page.getByLabel("Cari nama tempat").fill("Senyum");
    await page.getByLabel("Urutkan").selectOption({ label: "Skor tertinggi" });
    await page.getByLabel("Hanya Kunjungan terbukti").check();
    await page.getByRole("button", { name: "Terapkan" }).click();

    await expect(page).toHaveURL(/\/direktori\?/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe("Senyum");
    expect(params.get("urut")).toBe("skor");
    expect(params.get("terbukti")).toBe("1");
    // Applied filters keep the section open, folded or not.
    await expect(page.getByLabel("Cari nama tempat")).toBeVisible();
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

test("on desktop the filters sit open in a sidebar, labelled by a visible heading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The sidebar is the desktop layout");
  await page.goto("/direktori");
  await expect(filterSection(page).locator("summary")).toBeHidden();
  await expect(page.getByLabel("Cari nama tempat")).toBeVisible();
  await expect(page.getByLabel("Urutkan")).toBeVisible();
  await expect(page.getByRole("form", { name: "Filter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Filter" })).toBeVisible();
});

test("the intro names dental clinics, private dentists and hospitals", async ({ page }) => {
  await page.goto("/direktori");
  await expect(page.getByText(/^Klinik gigi, dokter gigi praktik pribadi dan rumah sakit/)).toBeVisible();
});

test("/direktori does not scroll sideways", async ({ page }) => {
  await page.goto("/direktori");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe("below desktop width", () => {
  test.skip(({ isMobile }) => !isMobile, "The folded Filter row is the phone layout");

  seeded(
    "the Filter section starts folded, so the first place shows without scrolling",
    async ({ page, firestore, unique }) => {
      await seedProvider(firestore, { placeId: `first-${unique}`, name: `Klinik Pertama ${unique}` });
      await page.goto("/direktori");

      await expect(filterSection(page)).not.toHaveAttribute("open");
      await expect(page.getByLabel("Cari nama tempat")).toBeHidden();
      await expect(page.getByLabel("Urutkan")).toBeHidden();
      await expect(page.locator(`section[aria-labelledby="directory-results"] li`).first()).toBeInViewport();

      await filterSection(page).locator("summary").click();
      await expect(page.getByLabel("Cari nama tempat")).toBeVisible();
      await expect(page.getByLabel("Urutkan")).toBeVisible();
      await expect(page.getByLabel("Provinsi")).toBeVisible();
    },
  );

  for (const search of ["q=Senyum", "urut=skor", "provinsi=31"]) {
    test(`/direktori?${search} starts with the Filter section open`, async ({ page }) => {
      await page.goto(`/direktori?${search}`);
      await expect(filterSection(page)).toHaveAttribute("open");
      await expect(page.getByLabel("Cari nama tempat")).toBeVisible();
    });
  }

  test("the default sort in the URL leaves the Filter section folded", async ({ page }) => {
    await page.goto("/direktori?urut=testimoni");
    await expect(filterSection(page)).not.toHaveAttribute("open");
  });
});
