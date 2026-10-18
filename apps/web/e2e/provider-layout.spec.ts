import { expect, test } from "@playwright/test";

// The Provider page in the new design (spec 08). Runs with PLACES_ADAPTER=fake and no
// Firestore, so the sample place is not a Listed Provider and its type is inferred.

test("the Provider page has one h1, reads its type as Klinik Gigi, and keeps one share link in main", async ({
  page,
}) => {
  await page.goto("/tempat/sample-klinik-senyum");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Klinik Gigi Senyum Contoh");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByText("Klinik Gigi (perkiraan)")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Info dari Google" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Testimoni pasien" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Ceritakan pengalamanmu" })).toHaveCount(1);
});

test("in English the Provider type reads Dental clinic", async ({ page }) => {
  await page.goto("/tempat/sample-klinik-senyum");
  await expect(page.getByText("Klinik Gigi (perkiraan)")).toBeVisible();
  await page
    .getByRole("group", { name: "Pilih bahasa" })
    .getByRole("button", { name: "Ganti bahasa ke English" })
    .click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Dental clinic (estimated)")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Share your experience" })).toHaveAttribute(
    "href",
    "/ceritakan?placeId=sample-klinik-senyum",
  );
});
