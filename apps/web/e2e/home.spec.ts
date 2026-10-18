import { expect, test } from "@playwright/test";

test("home shows the consent line in Indonesian before the complaint box, and the toggle switches to English", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  const consent = page.getByTestId("consent");
  await expect(consent).toContainText("Informasi edukasi, bukan diagnosis");

  const complaintBox = page.getByLabel("Ceritakan keluhan gigi Anda");
  const [consentBox, textBox] = await Promise.all([consent.boundingBox(), complaintBox.boundingBox()]);
  expect(consentBox && textBox && consentBox.y < textBox.y).toBe(true);

  // No horizontal scrolling at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Ganti bahasa ke English" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(consent).toContainText("Educational information, not a diagnosis");

  // Remembered per browser.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("a complaint gets a Guidance card, with the App Check token attached by the page", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Ceritakan keluhan gigi Anda").fill("Gigi geraham nyut-nyutan sejak tiga hari");
  await page.getByRole("button", { name: "Lihat panduan" }).click();

  await expect(page.getByText("Panduan untuk keluhan Anda")).toBeVisible();
});

test("on desktop the Summary panel sits beside the Guidance and links to the Shortlist", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Ceritakan keluhan gigi Anda").fill("Gigi geraham nyut-nyutan sejak tiga hari");
  await page.getByRole("button", { name: "Lihat panduan" }).click();
  await expect(page.getByText("Panduan untuk keluhan Anda")).toBeVisible();

  const summary = page.getByRole("complementary", { name: "Ringkasan" });
  if (testInfo.project.name !== "desktop") {
    await expect(summary).toBeHidden();
    return;
  }

  await expect(summary).toBeVisible();
  // Urgency Tier as a word, never color alone.
  await expect(summary.getByText("Segera", { exact: true })).toBeVisible();
  // A link to the Shortlist section, so the page keeps one button with that name.
  const toShortlist = summary.getByRole("link", { name: "Lihat dokter gigi terdekat" });
  await expect(toShortlist).toHaveAttribute("href", "#shortlist");
  await expect(page.getByRole("button", { name: "Lihat dokter gigi terdekat" })).toHaveCount(1);
  // One click does what "Gunakan lokasi saya" does: share the location and search.
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -7.2655, longitude: 112.7522 });
  await toShortlist.click();
  await expect(page.getByRole("region", { name: "Dokter gigi terdekat untuk keluhan Anda" })).toBeInViewport();
  await expect(page.getByText("Klinik Gigi Senyum Contoh")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lihat dokter gigi terdekat" })).toHaveCount(0);
});

test("a follow-up question takes focus, spans the page on desktop, and is answered with one tap", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Ceritakan keluhan gigi Anda").fill("Gigi geraham saya sudah bolong cukup dalam dan goyang");
  await page.getByRole("button", { name: "Lihat panduan" }).click();

  const card = page.getByRole("region", { name: "Satu pertanyaan lagi" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Perlu jawaban Anda")).toBeVisible();
  // Focus moves to the question, so it is announced and on screen.
  await expect(page.getByRole("heading", { name: "Satu pertanyaan lagi" })).toBeFocused();
  await expect(card).toBeInViewport();

  // On desktop, edge to edge with the hero above: from where the headline starts to where the complaint box ends.
  if (testInfo.project.name === "desktop") {
    const [cardBox, headlineBox, complaintBox] = await Promise.all([
      card.boundingBox(),
      page.getByRole("heading", { level: 1 }).boundingBox(),
      page.getByTestId("consent").locator("xpath=..").boundingBox(),
    ]);
    if (!cardBox || !headlineBox || !complaintBox) throw new Error("missing layout boxes");
    expect(Math.abs(cardBox.x - headlineBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox.x + cardBox.width - (complaintBox.x + complaintBox.width))).toBeLessThanOrEqual(1);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await card.getByRole("button", { name: "Tidak ada nyeri" }).click();
  await expect(page.getByText("Panduan untuk keluhan Anda")).toBeVisible();
});
