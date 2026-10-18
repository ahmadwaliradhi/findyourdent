import { expect, type Page, test } from "@playwright/test";

// About, Privacy and Terms (spec 08): reached from the footer; Privacy and Terms are drafts, kept out of search.
// The Testimony verification page (spec 09) sits beside them in the footer and is indexable.

async function robots(page: Page) {
  return page.locator('meta[name="robots"]').getAttribute("content");
}

test("the footer reaches About, Privacy and Terms, and only About is indexable", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");

  await footer.getByRole("link", { name: "Tentang kami" }).click();
  await expect(page).toHaveURL(/\/tentang$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pahami keluhan gigi Anda");
  await expect(page.getByText("Setiap negara baru hanya dibuka setelah")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  await footer.getByRole("link", { name: "Kebijakan privasi" }).click();
  await expect(page).toHaveURL(/\/privasi$/);
  await expect(page.getByRole("heading", { level: 1, name: "Kebijakan privasi" })).toBeVisible();
  await expect(page.getByText("Draf untuk ditinjau penasihat hukum sebelum tayang.")).toBeVisible();
  expect(await robots(page)).toBe("noindex");

  await footer.getByRole("link", { name: "Syarat penggunaan" }).click();
  await expect(page).toHaveURL(/\/syarat$/);
  await expect(page.getByRole("heading", { level: 1, name: "Syarat penggunaan" })).toBeVisible();
  await expect(page.getByText("Draf untuk ditinjau penasihat hukum sebelum tayang.")).toBeVisible();
  expect(await robots(page)).toBe("noindex");
});

test("About is in the main nav and marked current on its page", async ({ page }) => {
  await page.goto("/tentang");
  await expect(
    page.getByRole("navigation", { name: "Utama" }).getByRole("link", { name: "Tentang kami" }),
  ).toHaveAttribute("aria-current", "page");
});

test("the legal pages switch to English and keep their contents list", async ({ page }) => {
  await page.goto("/syarat");
  await page.getByRole("button", { name: "Ganti bahasa ke English" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
  await expect(page.getByText("Draft for review by legal counsel before publishing.")).toBeVisible();
  // Desktop shows the side list, phones a collapsed one to open first; either way it jumps to section 3.
  const collapsed = page.locator("details").filter({ visible: true });
  if (await collapsed.count()) {
    // A tap racing hydration can be lost; tap again until the list is open.
    await expect(async () => {
      if ((await collapsed.getAttribute("open")) === null) await collapsed.getByText("Contents").click();
      await expect(collapsed).toHaveAttribute("open", "", { timeout: 1000 });
    }).toPass();
  }
  await page.getByRole("link", { name: "3. Emergencies" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/#s3$/);
  await expect(page.getByRole("heading", { name: "3. Emergencies" })).toBeInViewport();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
    "href",
    "/privasi",
  );
});

test("the footer and the Testimony form reach the verification page, which switches to English", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Cara kami memverifikasi testimoni" }).click();
  await expect(page).toHaveURL(/\/verifikasi-testimoni$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cara kami memverifikasi testimoni" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Minimal 3 Testimoni terbukti" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Ganti bahasa ke English" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How we verify Testimonies" })).toBeVisible();
  await expect(page).toHaveURL(/\/verifikasi-testimoni$/);

  await page.goto("/ceritakan");
  await expect(page.getByRole("main").getByRole("link", { name: "How we verify Testimonies" })).toHaveAttribute(
    "href",
    "/verifikasi-testimoni",
  );
});

for (const path of ["/tentang", "/privasi", "/syarat", "/verifikasi-testimoni"]) {
  test(`${path} does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
