// Steps on the deployed site shared by the journeys and the demo captures (e2e-capture/):
// App Check, the posting form, and deleting what a run wrote.
import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";
import { APP_CHECK_DEBUG_TOKEN_ENV, PLACE_ID_ENV } from "./env.ts";

/** The Firebase App Check SDK swaps a debug token for reCAPTCHA when this global is set before it loads. */
export async function addDebugToken(context: BrowserContext) {
  await context.addInitScript((token) => {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
  }, process.env[APP_CHECK_DEBUG_TOKEN_ENV] ?? "");
}

export const placeId = () => process.env[PLACE_ID_ENV] ?? "";

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function rate(page: Page, aspect: string, score: number) {
  await page
    .getByRole("group", { name: aspect })
    .getByRole("radio", { name: `${score} dari 5` })
    .check({ force: true });
}

/** The Listed Provider's name, as its page shows it. */
export async function listedProviderName(page: Page): Promise<string> {
  await page.goto(`/tempat/${placeId()}`);
  const name = (await page.getByRole("heading", { level: 1 }).textContent())?.trim();
  if (!name) throw new Error(`no Provider page for ${placeId()}`);
  return name;
}

export const testimonyCard = (page: Page, testimonyId: string) =>
  page.locator(`section[aria-labelledby="testimony-${testimonyId}"]`);

/**
 * Deletes the author's test Testimonies at the place (only those with one of `texts`,
 * never one the account wrote for real), including any left by a run that stopped midway.
 */
export async function deleteTestTestimonies(page: Page, providerName: string, texts: string[]) {
  await page.goto("/testimoni-saya");
  await expect(page.getByRole("heading", { level: 1, name: "Testimoni saya" })).toBeVisible();
  const cards = page
    .locator("section[aria-labelledby^='testimony-']")
    .filter({ has: page.getByRole("heading", { level: 2, name: providerName, exact: true }) })
    .filter({ hasText: new RegExp(texts.map(escapeRegExp).join("|")) });
  while ((await cards.count()) > 0) {
    await deleteCard(page, cards.first());
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function deleteCard(page: Page, card: Locator) {
  await card.getByRole("button", { name: "Hapus", exact: true }).click();
  await card.getByRole("alertdialog").getByRole("button", { name: "Ya, hapus" }).click();
  await expect(page.getByText("Testimoni sudah dihapus.")).toBeVisible();
  await expect(card).toHaveCount(0);
}

export async function deleteMyTestimony(page: Page, testimonyId: string) {
  await page.goto("/testimoni-saya");
  await deleteCard(page, testimonyCard(page, testimonyId));
}

export interface TestimonyDraft {
  text: string;
  /** Shown on the Testimony. */
  displayName?: string;
  /** The visit month as YYYY-MM; by default January of the form's second year option. */
  visitMonth?: string;
  /** Typed key by key, so a recording shows it being written. */
  typeDelayMs?: number;
}

/** Fills the posting form for the place in E2E_PLACE_ID, up to Kirim. */
export async function fillTestimony(page: Page, draft: TestimonyDraft) {
  await page.goto(`/ceritakan?placeId=${encodeURIComponent(placeId())}`);
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  // The form asks whether the place is Listed; until it answers, Kirim would ask for its name and region.
  await expect(page.getByText("Tempat ini sudah terdaftar di FindYourDent.")).toBeVisible();
  await rate(page, "Pelayanan", 5);
  await rate(page, "Kebersihan", 5);
  await rate(page, "Bahan dan alat", 4);
  const story = page.getByLabel("Cerita Anda");
  if (draft.typeDelayMs) await story.pressSequentially(draft.text, { delay: draft.typeDelayMs });
  else await story.fill(draft.text);
  if (draft.visitMonth) {
    const [year, month] = draft.visitMonth.split("-");
    await page.getByLabel("Tahun").selectOption(year ?? "");
    await page.getByLabel("Bulan", { exact: true }).selectOption(month ?? "");
  } else {
    await page.getByLabel("Tahun").selectOption({ index: 1 });
    await page.getByLabel("Bulan", { exact: true }).selectOption("01");
  }
  await page.getByLabel("Nama yang ditampilkan").fill(draft.displayName ?? "Uji E2E");
  await page.getByLabel("Ini pengalaman saya sendiri, saya tulis dengan jujur.").check();
  await page.getByLabel("Tulisan dan foto saya tidak memuat data pribadi orang lain.").check();
}

export interface SubmitAnswer {
  status: string;
  testimonyId?: string;
  verifiedVisit?: boolean;
}

/** Clicks Kirim and returns the API's answer to that submit; an error answer fails with its body. */
export async function submit(page: Page): Promise<SubmitAnswer> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/testimonies(\/|$)/.test(r.url())),
    page.getByRole("button", { name: "Kirim" }).click(),
  ]);
  if (!response.ok()) throw new Error(`POST ${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response.json();
}
