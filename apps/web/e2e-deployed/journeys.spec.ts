// The three end-to-end journeys of spec 02 and spec 03, on the deployed site.
// Everything is real: Gemini, Places, Moderation, Firestore and App Check (through
// the registered debug token). The Testimony journeys publish or hold on the place
// in E2E_PLACE_ID and delete what they wrote before they finish.
import { fileURLToPath } from "node:url";
import { test as base, devices, expect } from "@playwright/test";
import { ADMIN_SESSION_PATH } from "./env.ts";
import { checkAdmin, checkAuthorAndPlace } from "./session.ts";
import {
  addDebugToken,
  deleteCard,
  deleteMyTestimony,
  deleteTestTestimonies,
  fillTestimony,
  listedProviderName,
  noHorizontalScroll,
  placeId,
  submit,
  testimonyCard,
} from "./testimony.ts";

const test = base.extend({
  context: async ({ context }, use) => {
    await addDebugToken(context);
    await use(context);
  },
});

// A receipt with invented data: Moderation holds any flagged photo for an admin, and
// held this one in all six runs of the Moderation evaluation (case photo-receipt).
const HELD_PHOTO = fileURLToPath(
  new URL("../../../services/agent/evals/moderation/photos/receipt.png", import.meta.url),
);

const PHONE_TEXT = "Dokternya sabar dan ruang tunggunya bersih. Kalau mau janji, hubungi saya di 0812-3456-7890.";
const CLEAN_TEXT = "Dokternya sabar menjelaskan sebelum menambal, dan ruang tunggunya bersih.";
const TEST_TEXTS = [PHONE_TEXT, CLEAN_TEXT];

test.describe("Patient without an account", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("complaint to Guidance to Shortlist to Provider page to 'Lihat ulasan Google'", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Ceritakan keluhan gigi Anda").fill("Gigi geraham kiri bawah nyut-nyutan sejak tiga hari");
    await page.getByRole("button", { name: "Lihat panduan" }).click();

    // Gemini may ask one follow-up question first, with or without quick replies; a written answer always works.
    const guidance = page.getByText("Panduan untuk keluhan Anda");
    const followUp = page.getByRole("region", { name: "Satu pertanyaan lagi" });
    await expect(guidance.or(followUp)).toBeVisible();
    if (await followUp.isVisible()) {
      await followUp.getByLabel("Jawaban Anda").fill("Saya kurang tahu");
      await followUp.getByRole("button", { name: "Kirim jawaban" }).click();
    }
    await expect(guidance).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByRole("button", { name: "Lihat dokter gigi terdekat" }).click();
    await page.getByLabel("Atau tulis area Anda").fill("Gubeng, Surabaya");
    await page.getByRole("button", { name: "Cari", exact: true }).click();
    const firstCard = page.locator("[data-place-id]").first();
    await expect(firstCard).toBeVisible();

    await firstCard.getByRole("link", { name: "Lihat halaman" }).click();
    await expect(page).toHaveURL(/\/tempat\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByRole("link", { name: "Buka di Google Maps" })).toBeVisible();

    await page.getByRole("button", { name: "Lihat ulasan Google" }).click();
    const reviews = page.getByTestId("google-reviews");
    await expect(reviews.getByText("Sumber: Google Maps")).toBeVisible();
    await noHorizontalScroll(page);
  });
});

test.describe("signed-in Patient and admin", () => {
  let providerName = "";

  test.beforeAll(checkAuthorAndPlace);

  test.beforeEach(async ({ page }) => {
    providerName = await listedProviderName(page);
    await deleteTestTestimonies(page, providerName, TEST_TEXTS);
  });

  // Whatever happened, nothing this run wrote stays on a real Provider's page.
  test.afterEach(async ({ page }) => {
    if (providerName) await deleteTestTestimonies(page, providerName, TEST_TEXTS);
  });

  test("posting a Testimony with a phone number, fixing it, publishing", async ({ page }) => {
    await fillTestimony(page, { text: PHONE_TEXT });
    const first = await submit(page);
    expect(first.status).toBe("needsAuthorFix");

    const panel = page.getByRole("alert");
    await expect(panel).toContainText("Sedikit perbaikan sebelum terkirim");
    await expect(panel.locator("mark")).toContainText("0812");
    await expect(page.getByLabel("Cerita Anda")).toHaveAttribute("aria-invalid", "true");
    await noHorizontalScroll(page);

    await page.getByLabel("Cerita Anda").fill(CLEAN_TEXT);
    const second = await submit(page);
    expect(second.status).toBe("published");
    await expect(page.getByRole("heading", { name: "Testimoni Anda sudah terbit" })).toBeVisible();
    if (!second.testimonyId) throw new Error("no testimonyId in the publish answer");

    // Public on the Provider page, then gone once the author deletes it.
    await page.goto(`/tempat/${placeId()}`);
    await expect(page.getByText(CLEAN_TEXT)).toBeVisible();
    await deleteMyTestimony(page, second.testimonyId);
  });

  test("an admin decides on a held Testimony", async ({ page, browser, baseURL }) => {
    await checkAdmin();
    await fillTestimony(page, { text: CLEAN_TEXT });
    await page.getByLabel("Tambah foto").setInputFiles(HELD_PHOTO);
    const posted = await submit(page);
    expect(posted.status).toBe("held");
    await expect(page.getByRole("heading", { name: "Testimoni Anda sedang ditinjau" })).toBeVisible();
    const { testimonyId } = posted;
    if (!testimonyId) throw new Error("no testimonyId in the hold answer");

    // The admin, on their own phone, finds it in the queue and turns it down ("Tolak") with a reason.
    const adminContext = await browser.newContext({
      ...devices["Pixel 5"],
      viewport: { width: 360, height: 780 },
      baseURL,
      storageState: ADMIN_SESSION_PATH,
      locale: "id-ID",
    });
    try {
      await addDebugToken(adminContext);
      const admin = await adminContext.newPage();
      await admin.goto("/admin");
      const item = admin.locator(`article[aria-labelledby="queue-held-${testimonyId}"]`);
      await expect(item.getByRole("heading", { name: `Testimoni ditahan · ${providerName}` })).toBeVisible();
      await expect(item.getByText(CLEAN_TEXT)).toBeVisible();
      await expect(item.getByRole("img", { name: "Foto 1" })).toBeVisible();
      await noHorizontalScroll(admin);

      await item.getByRole("button", { name: "Tolak", exact: true }).click();
      await item.getByLabel(/^Alasan untuk "Tolak"/).fill("Uji end-to-end otomatis, bukan Testimoni sungguhan.");
      await item.getByRole("button", { name: "Tolak", exact: true }).click();
      await expect(item).toHaveCount(0);
    } finally {
      await adminContext.close();
    }

    // The author sees the decision and its reason, then deletes the test Testimony.
    await page.goto("/testimoni-saya");
    const card = testimonyCard(page, testimonyId);
    await expect(card.getByText("Tidak ditayangkan")).toBeVisible();
    await expect(card.getByText("Uji end-to-end otomatis, bukan Testimoni sungguhan.")).toBeVisible();
    await deleteCard(page, card);
  });
});
