// The three end-to-end journeys of spec 02 and spec 03, on the deployed site.
// Everything is real: Gemini, Places, Moderation, Firestore and App Check (through
// the registered debug token). The Testimony journeys publish or hold on the place
// in E2E_PLACE_ID and delete what they wrote before they finish.
import { fileURLToPath } from "node:url";
import { type BrowserContext, test as base, devices, expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, APP_CHECK_DEBUG_TOKEN_ENV, PLACE_ID_ENV } from "./env.ts";
import { checkAdmin, checkAuthorAndPlace } from "./session.ts";

/** The Firebase App Check SDK swaps a debug token for reCAPTCHA when this global is set before it loads. */
async function addDebugToken(context: BrowserContext) {
  await context.addInitScript((token) => {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
  }, process.env[APP_CHECK_DEBUG_TOKEN_ENV] ?? "");
}

const test = base.extend({
  context: async ({ context }, use) => {
    await addDebugToken(context);
    await use(context);
  },
});

const placeId = () => process.env[PLACE_ID_ENV] ?? "";

// A receipt with invented data: Moderation holds any flagged photo for an admin, and
// held this one in all six runs of the Moderation evaluation (case photo-receipt).
const HELD_PHOTO = fileURLToPath(
  new URL("../../../services/agent/evals/moderation/photos/receipt.png", import.meta.url),
);

const PHONE_TEXT = "Dokternya sabar dan ruang tunggunya bersih. Kalau mau janji, hubungi saya di 0812-3456-7890.";
const CLEAN_TEXT = "Dokternya sabar menjelaskan sebelum menambal, dan ruang tunggunya bersih.";
const TEST_TEXTS = [PHONE_TEXT, CLEAN_TEXT];

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function rate(page: Page, aspect: string, score: number) {
  await page
    .getByRole("group", { name: aspect })
    .getByRole("radio", { name: `${score} dari 5` })
    .check({ force: true });
}

/** The Listed Provider's name, as its page shows it. */
async function listedProviderName(page: Page): Promise<string> {
  await page.goto(`/tempat/${placeId()}`);
  const name = (await page.getByRole("heading", { level: 1 }).textContent())?.trim();
  if (!name) throw new Error(`no Provider page for ${placeId()}`);
  return name;
}

const testimonyCard = (page: Page, testimonyId: string) =>
  page.locator(`section[aria-labelledby="testimony-${testimonyId}"]`);

/**
 * Deletes the author's test Testimonies at the place (only those with this file's texts,
 * never one the account wrote for real), including any left by a run that stopped midway.
 */
async function deleteTestTestimonies(page: Page, providerName: string) {
  await page.goto("/testimoni-saya");
  await expect(page.getByRole("heading", { level: 1, name: "Testimoni saya" })).toBeVisible();
  const cards = page
    .locator("section[aria-labelledby^='testimony-']")
    .filter({ has: page.getByRole("heading", { level: 2, name: providerName, exact: true }) })
    .filter({ hasText: new RegExp(TEST_TEXTS.map(escapeRegExp).join("|")) });
  while ((await cards.count()) > 0) {
    await deleteCard(page, cards.first());
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function deleteCard(page: Page, card: Locator) {
  await card.getByRole("button", { name: "Hapus", exact: true }).click();
  await card.getByRole("alertdialog").getByRole("button", { name: "Ya, hapus" }).click();
  await expect(page.getByText("Testimoni sudah dihapus.")).toBeVisible();
  await expect(card).toHaveCount(0);
}

async function deleteMyTestimony(page: Page, testimonyId: string) {
  await page.goto("/testimoni-saya");
  await deleteCard(page, testimonyCard(page, testimonyId));
}

/** Fills the posting form for the place in E2E_PLACE_ID, up to Kirim. */
async function fillTestimony(page: Page, text: string) {
  await page.goto(`/ceritakan?placeId=${encodeURIComponent(placeId())}`);
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  // The form asks whether the place is Listed; until it answers, Kirim would ask for its name and region.
  await expect(page.getByText("Tempat ini sudah terdaftar di FindYourDent.")).toBeVisible();
  await rate(page, "Pelayanan", 5);
  await rate(page, "Kebersihan", 5);
  await rate(page, "Bahan dan alat", 4);
  await page.getByLabel("Cerita Anda").fill(text);
  await page.getByLabel("Tahun").selectOption({ index: 1 });
  await page.getByLabel("Bulan", { exact: true }).selectOption("01");
  await page.getByLabel("Nama yang ditampilkan").fill("Uji E2E");
  await page.getByLabel("Ini pengalaman saya sendiri, saya tulis dengan jujur.").check();
  await page.getByLabel("Tulisan dan foto saya tidak memuat data pribadi orang lain.").check();
}

/** Clicks Kirim and returns the API's answer to that submit; an error answer fails with its body. */
async function submit(page: Page): Promise<{ status: string; testimonyId?: string }> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/testimonies(\/|$)/.test(r.url())),
    page.getByRole("button", { name: "Kirim" }).click(),
  ]);
  if (!response.ok()) throw new Error(`POST ${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response.json();
}

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
    await deleteTestTestimonies(page, providerName);
  });

  // Whatever happened, nothing this run wrote stays on a real Provider's page.
  test.afterEach(async ({ page }) => {
    if (providerName) await deleteTestTestimonies(page, providerName);
  });

  test("posting a Testimony with a phone number, fixing it, publishing", async ({ page }) => {
    await fillTestimony(page, PHONE_TEXT);
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
    await fillTestimony(page, CLEAN_TEXT);
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
