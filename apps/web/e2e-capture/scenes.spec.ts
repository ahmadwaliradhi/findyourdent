// The demo video's screen captures (issue #111): one clip per storyboard scene of
// docs/submission/video/narration.md, recorded on the deployed site with nothing mocked.
// Each clip is at least as long as its scene's target, and scene 4 deletes the Testimony
// it posts once its clip is saved.
//
// Scene 4 posts on the Listed Provider in E2E_PLACE_ID. With a real receipt from a visit
// there, Moderation accepts it as Proof of Visit (spec 09: Provider name on it, dated within
// a month of the visit, under 12 months old) and the clip ends on the demo Testimony's
// Kunjungan terbukti badge. The receipt stays outside the repository:
//   CAPTURE_PROOF_PATH=/path/to/receipt.jpg CAPTURE_VISIT_MONTH=2026-09 E2E_PLACE_ID=<id> \
//     pnpm --filter web capture:deployed
// Without one, the demo Testimony publishes as "Belum terbukti" and the clip ends on a real
// Proven Testimony in the feed instead. Never attach an invented receipt: that would be a
// fake Proof of Visit on the live site.
import { existsSync } from "node:fs";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { checkAuthorAndPlace } from "../e2e-deployed/session.ts";
import {
  addDebugToken,
  deleteTestTestimonies,
  fillTestimony,
  listedProviderName,
  placeId,
  submit,
} from "../e2e-deployed/testimony.ts";
import { Clip } from "./clip.ts";

const test = base.extend<{ clip: (scene: number, slug: string) => Clip }>({
  context: async ({ context }, use) => {
    await addDebugToken(context);
    await use(context);
  },
  clip: async ({ page, baseURL }, use) => {
    await use((scene, slug) => new Clip(page, scene, slug, baseURL ?? ""));
  },
});

// Gubeng, Surabaya: dense with dental practices in Places.
const GUBENG = { latitude: -7.2654, longitude: 112.7498 };

const ROUTINE_COMPLAINT = "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari, makin sakit kalau malam";
const EMERGENCY_COMPLAINT = "Pipi kanan saya bengkak sampai ke bawah mata dan saya demam tinggi sejak semalam";

// The demo Testimony, marked as a demo by its display name; deleted after the clip.
const DEMO_NAME = "Demo FindYourDent";
const DEMO_PHONE_TEXT =
  "Dokternya sabar menjelaskan sebelum menambal dan ruang tunggunya bersih. Kalau mau tanya, hubungi saya di 0812-3456-7890.";
const DEMO_CLEAN_TEXT = "Dokternya sabar menjelaskan sebelum menambal dan ruang tunggunya bersih.";
const DEMO_TEXTS = [DEMO_PHONE_TEXT, DEMO_CLEAN_TEXT];

const TYPING_DELAY_MS = 45;

/** Scrolls smoothly until `target` sits at the top of the screen, the way a thumb would. */
async function scrollTo(target: Locator, block: "start" | "center" = "start") {
  await target.evaluate((element, b) => element.scrollIntoView({ behavior: "smooth", block: b }), block);
  await target.page().waitForTimeout(1200);
}

/** Answers Gemini's one follow-up question, when it asks one, then waits for the Guidance card. */
async function guidanceFor(page: Page, complaint: string, card: Locator, delay = TYPING_DELAY_MS) {
  await page.getByLabel("Ceritakan keluhan gigi Anda").pressSequentially(complaint, { delay });
  await page.getByRole("button", { name: "Lihat panduan" }).click();
  const followUp = page.getByRole("region", { name: "Satu pertanyaan lagi" });
  await expect(card.or(followUp).first()).toBeVisible();
  if (await followUp.isVisible()) {
    await page.waitForTimeout(delay ? 1500 : 0);
    await followUp.getByLabel("Jawaban Anda").pressSequentially("Saya kurang tahu", { delay });
    await followUp.getByRole("button", { name: "Kirim jawaban" }).click();
  }
  await expect(card).toBeVisible();
}

test.describe("Patient without an account", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("scene 1: the landing page down to 'Testimoni terbaru'", async ({ page, clip }) => {
    const scene = clip(1, "landing");
    await page.goto("/");
    await expect(page.getByLabel("Ceritakan keluhan gigi Anda")).toBeVisible();
    scene.start();
    await scene.hold(4);
    const feed = page.getByRole("heading", { name: "Testimoni terbaru" });
    await scrollTo(feed);
    // A real Testimony card, the first in the feed.
    const firstTestimony = page.locator("section[aria-labelledby='feed-title'] li").first();
    await expect(firstTestimony).toBeVisible();
    await scene.hold(3);
    await scrollTo(firstTestimony, "center");
    await scene.hold(4);
    await scene.finish();
  });

  test("scene 2: Guidance with the BPJS answer, then the emergency case", async ({ page, clip }) => {
    const scene = clip(2, "guidance");
    await page.goto("/");
    await expect(page.getByLabel("Ceritakan keluhan gigi Anda")).toBeEditable();
    scene.start();
    await scene.hold(2);

    const guidance = page.getByText("Panduan untuk keluhan Anda");
    await guidanceFor(page, ROUTINE_COMPLAINT, guidance);
    await scrollTo(guidance);
    await scene.hold(4);
    for (const section of ["Perkiraan kunjungan", "Perkiraan biaya", "BPJS Kesehatan"]) {
      await scrollTo(page.getByText(section).first(), "center");
      await scene.hold(4);
    }

    // The emergency case: the red-flag check answers before Gemini.
    await page.goto("/");
    await expect(page.getByLabel("Ceritakan keluhan gigi Anda")).toBeEditable();
    const emergency = page.getByText("Ke IGD sekarang").first();
    await guidanceFor(page, EMERGENCY_COMPLAINT, emergency);
    await scrollTo(emergency);
    await expect(page.getByText("Tanda bahaya yang terdeteksi")).toBeVisible();
    await scene.hold(4);
    await scrollTo(page.getByRole("link", { name: "Cari IGD terdekat di Google Maps" }), "center");
    await scene.finish();
  });

  test.describe(() => {
    test.use({ geolocation: GUBENG, permissions: ["geolocation"] });

    test("scene 3: Shortlist, a Provider page and 'Lihat ulasan Google'", async ({ page, clip }) => {
      const scene = clip(3, "shortlist");
      // The Guidance card is set up before the clip starts; the scene opens on it.
      await page.goto("/");
      await guidanceFor(page, ROUTINE_COMPLAINT, page.getByText("Panduan untuk keluhan Anda"), 0);
      const toShortlist = page.getByRole("button", { name: "Lihat dokter gigi terdekat" });
      await expect(toShortlist).toBeVisible();
      await toShortlist.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(500);

      scene.start();
      await scene.hold(1.5);
      await toShortlist.click();
      await page.getByRole("button", { name: "Gunakan lokasi saya" }).click();
      const cards = page.locator("[data-place-id]");
      await expect(cards).toHaveCount(5);
      await scrollTo(page.getByTestId("shortlist"));
      await scene.hold(3);
      // Through every card, reason and scores, to the ranking note.
      const count = await cards.count();
      for (let index = 0; index < count; index++) {
        await scrollTo(cards.nth(index), "center");
        await scene.hold(1.5);
      }
      await scrollTo(page.getByText("Tidak pernah berdasarkan bayaran"), "center");
      await scene.hold(2);

      await scrollTo(cards.first(), "center");
      await cards.first().getByRole("link", { name: "Lihat halaman" }).click();
      await expect(page).toHaveURL(/\/tempat\/[^/]+$/);
      await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
      await scene.hold(3);
      const reviewsButton = page.getByRole("button", { name: "Lihat ulasan Google" });
      await scrollTo(reviewsButton, "center");
      await scene.hold(1);
      await reviewsButton.click();
      const reviews = page.getByTestId("google-reviews");
      await expect(reviews.getByText("Sumber: Google Maps")).toBeVisible();
      await scrollTo(reviews);
      await scene.hold(3);
      await scene.finish();
    });
  });

  test("scene 5: the live 'Dampak FindYourDent' counter", async ({ page, clip }) => {
    const scene = clip(5, "impact");
    await page.goto("/");
    const counter = page.getByTestId("impact-counter");
    await expect(counter).toBeVisible();
    scene.start();
    await scene.hold(2);
    await scrollTo(counter, "center");
    await expect(counter.getByText("Kunjungan terbukti")).toBeVisible();
    await scene.finish();
  });
});

/** A real receipt for scene 4, if there is one. */
const PROOF_PATH = process.env.CAPTURE_PROOF_PATH;

test.describe("signed-in Patient", () => {
  let providerName = "";

  test.beforeAll(async () => {
    await checkAuthorAndPlace();
    if (!PROOF_PATH) return;
    if (!existsSync(PROOF_PATH)) throw new Error(`CAPTURE_PROOF_PATH: no file at ${PROOF_PATH}`);
    if (!/^\d{4}-\d{2}$/.test(process.env.CAPTURE_VISIT_MONTH ?? "")) {
      throw new Error("Set CAPTURE_VISIT_MONTH to the receipt's visit month, as YYYY-MM.");
    }
  });

  test.beforeEach(async ({ context }) => {
    // On a page of its own, so the clip's video starts clean.
    const setup = await context.newPage();
    providerName = await listedProviderName(setup);
    await deleteTestTestimonies(setup, providerName, DEMO_TEXTS);
    await setup.close();
  });

  // Whatever happened, the demo Testimony does not stay on a real Provider's page.
  test.afterEach(async ({ context }) => {
    if (!providerName) return;
    const cleanup = await context.newPage();
    await deleteTestTestimonies(cleanup, providerName, DEMO_TEXTS);
    await cleanup.close();
  });

  test("scene 4: fix-before-submit, publishing and Kunjungan terbukti", async ({ page, clip }) => {
    const scene = clip(4, "testimony");
    // fillTestimony opens the form; the clip starts on its first frame.
    scene.start();
    await fillTestimony(page, {
      text: DEMO_PHONE_TEXT,
      displayName: DEMO_NAME,
      visitMonth: PROOF_PATH ? process.env.CAPTURE_VISIT_MONTH : undefined,
      typeDelayMs: TYPING_DELAY_MS,
    });
    if (PROOF_PATH) await page.getByLabel("Pilih file bukti").setInputFiles(PROOF_PATH);
    await scrollTo(page.getByRole("button", { name: "Kirim" }), "center");
    await scene.hold(1);

    const first = await submit(page);
    expect(first.status).toBe("needsAuthorFix");
    const panel = page.getByRole("alert");
    await expect(panel).toContainText("Sedikit perbaikan sebelum terkirim");
    await scrollTo(panel, "center");
    await scene.hold(4);

    const story = page.getByLabel("Cerita Anda");
    await scrollTo(story, "center");
    await story.clear();
    await story.pressSequentially(DEMO_CLEAN_TEXT, { delay: TYPING_DELAY_MS });
    await scrollTo(page.getByRole("button", { name: "Kirim" }), "center");
    const second = await submit(page);
    expect(second.status).toBe("published");
    await expect(page.getByRole("heading", { name: "Testimoni Anda sudah terbit" })).toBeVisible();
    if (PROOF_PATH) {
      expect(second.verifiedVisit, "Moderation did not accept the receipt as Proof of Visit").toBe(true);
      await expect(page.getByText(/ditandai Kunjungan terbukti/)).toBeVisible();
    }
    await scene.hold(4);

    // The published Testimony on the Provider page.
    await page.goto(`/tempat/${placeId()}`);
    const testimony = page.locator("section[aria-labelledby^='testimony-']").filter({ hasText: DEMO_CLEAN_TEXT });
    await scrollTo(testimony, "center");
    await scene.hold(3);
    if (PROOF_PATH) {
      await expect(testimony.getByText("Kunjungan terbukti")).toBeVisible();
    } else {
      // A Patient's real Proven Testimony, from the feed filtered to Kunjungan terbukti.
      await page.goto("/?terbukti=1");
      const proven = page.locator("section[aria-labelledby='feed-title'] li").filter({ hasText: "Kunjungan terbukti" });
      await scrollTo(proven.first(), "center");
      await expect(proven.first().getByText("Kunjungan terbukti")).toBeVisible();
    }
    await scene.finish();
  });
});
