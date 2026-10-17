import { expect, test } from "@playwright/test";
import { countGuidanceSubmits, countRequests, guidanceAndShortlist } from "./support";

// What the home page showed, kept across a reload and a language switch (spec 02):
// only the signed Guidance token is stored, never the Shortlist, complaint or area.

test("a reload brings the Guidance card back from its token, and the Shortlist waits for a tap", async ({ page }) => {
  const guidancePosts = countGuidanceSubmits(page);
  await guidanceAndShortlist(page);
  expect(guidancePosts).toHaveLength(1);
  const searches = countRequests(page, "/api/shortlist");

  await page.reload();

  await expect(page.getByText("Panduan untuk keluhan Anda")).toBeVisible();
  const shortlist = page.getByTestId("shortlist");
  await expect(shortlist.getByRole("button", { name: "Gunakan lokasi saya" })).toBeVisible();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toHaveCount(0);
  expect(guidancePosts).toHaveLength(1);
  expect(searches).toEqual([]);

  const stored = await page.evaluate(() => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]));
  expect(stored).not.toContain("Contoh");
  expect(stored).not.toContain("Gubeng");
  expect(stored).not.toContain("nyut-nyutan");

  await page.getByLabel("Atau tulis area Anda").fill("Gubeng, Surabaya");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toBeVisible();
  expect(searches).toHaveLength(1);
});

test("switching the language keeps the Guidance card and says how to get it in the new language", async ({ page }) => {
  await guidanceAndShortlist(page);
  const guidancePosts = countGuidanceSubmits(page);

  await page.getByRole("button", { name: "Ganti bahasa ke English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await expect(page.getByText("Guidance for your problem")).toBeVisible();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toBeVisible();
  const note = page.getByTestId("guidance-language");
  await expect(note).toHaveText(
    "This Guidance is in Bahasa Indonesia, the language of your complaint. Write your complaint in English to get Guidance in English.",
  );
  expect(guidancePosts).toEqual([]);

  // Back to the entry before the switch: the card is there too, still with the note.
  await page.goBack();
  await expect(page.getByText("Guidance for your problem")).toBeVisible();
  await expect(note).toBeVisible();
  await page.goForward();
  await expect(page.getByText("Guidance for your problem")).toBeVisible();
  // Asking again would only repeat the complaint's language, so the note makes no Gemini call.
  await expect(note.getByRole("button")).toHaveCount(0);
  expect(guidancePosts).toEqual([]);
});

test("a reload after switching the language still brings the Guidance card back", async ({ page }) => {
  await guidanceAndShortlist(page);
  await page.getByRole("button", { name: "Ganti bahasa ke English" }).click();
  await expect(page.getByText("Guidance for your problem")).toBeVisible();

  await page.reload();

  await expect(page.getByText("Guidance for your problem")).toBeVisible();
  await expect(page.getByTestId("guidance-language")).toBeVisible();
});
