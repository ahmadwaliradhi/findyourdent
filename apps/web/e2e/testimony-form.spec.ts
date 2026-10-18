import { expect, type Page, test } from "@playwright/test";

// Runs with PLACES_ADAPTER=fake and no Firebase (playwright.config.ts): the picker
// finds the made-up sample places, and Kirim cannot reach a signed-in submit.

// A 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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

test("the Provider page links to the form with its place picked", async ({ page }) => {
  await page.goto("/tempat/sample-klinik-senyum");
  const link = page.getByRole("main").getByRole("link", { name: "Ceritakan pengalamanmu" });
  await expect(link).toHaveAttribute("href", "/ceritakan?placeId=sample-klinik-senyum");
});

test("posting form: fills up to Kirim, keeps a draft across a reload, and asks to reattach photos", async ({
  page,
}) => {
  await page.goto("/ceritakan");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");

  // Kirim on an empty form shows what is missing, without sending anything.
  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByRole("alert")).toHaveText("Periksa kembali isian yang ditandai.");
  await expect(page.getByText("Centang kedua pernyataan untuk mengirim.")).toBeVisible();

  await page.getByRole("combobox", { name: "Tempat praktik" }).fill("klinik");
  await page.getByText("Klinik Gigi Senyum Contoh").click();
  await page.getByLabel("Nama tempat sesuai papan nama atau yang kamu kenal").fill("Klinik Senyum Gubeng");
  await page.getByLabel("Provinsi").selectOption({ label: "Jawa Timur" });
  await page.getByLabel("Kota/Kabupaten").selectOption({ label: "Kota Surabaya" });

  await rate(page, "Pelayanan", 5);
  await rate(page, "Kebersihan", 4);
  await rate(page, "Bahan dan alat", 4);
  await page.getByLabel("Cerita Anda").fill("Dokternya sabar, ruang tunggunya bersih.");
  await expect(page.getByText("40 / 10.000 karakter")).toBeVisible();
  await page.getByLabel("Tahun").selectOption({ index: 2 });
  await page.getByLabel("Bulan", { exact: true }).selectOption("01");
  await page.getByLabel("Biaya yang dibayar (opsional)").fill("350000");
  await expect(page.getByLabel("Biaya yang dibayar (opsional)")).toHaveValue("350.000");
  await page.getByLabel("Tambah foto").setInputFiles({ name: "ruang-tunggu.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "Foto 1" })).toBeVisible();
  await page.getByLabel("Nama yang ditampilkan").fill("Siti R.");
  await page.getByLabel("Ini pengalaman saya sendiri, saya tulis dengan jujur.").check();
  await page.getByLabel("Tulisan dan foto saya tidak memuat data pribadi orang lain.").check();
  await noHorizontalScroll(page);

  await page.reload();
  await expect(page.getByText("Draf Anda dipulihkan.")).toBeVisible();
  await expect(page.getByText(/Pilih lagi sebelum mengirim/)).toBeVisible();
  await expect(page.getByLabel("Cerita Anda")).toHaveValue("Dokternya sabar, ruang tunggunya bersih.");
  await expect(page.getByLabel("Nama yang ditampilkan")).toHaveValue("Siti R.");
  await expect(page.getByLabel("Biaya yang dibayar (opsional)")).toHaveValue("350.000");
  await expect(page.getByRole("img", { name: "Foto 1" })).toHaveCount(0);

  // No Firebase here, so the submit cannot finish; the draft stays.
  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Cerita Anda")).toHaveValue("Dokternya sabar, ruang tunggunya bersih.");
});

const PHONE_TEXT = "Dokternya sabar. Hubungi saja 0812-3456-7890 untuk janji.";

/** Fills a complete form for a place that is not Listed yet. */
async function fillForm(page: Page, text: string) {
  await page.goto("/ceritakan");
  // Kirim is enabled once the form has hydrated; the picker only searches after that.
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Tempat praktik" }).fill("klinik");
  await page.getByText("Klinik Gigi Senyum Contoh").click();
  await page.getByLabel("Nama tempat sesuai papan nama atau yang kamu kenal").fill("Klinik Senyum Gubeng");
  await page.getByLabel("Provinsi").selectOption({ label: "Jawa Timur" });
  await page.getByLabel("Kota/Kabupaten").selectOption({ label: "Kota Surabaya" });
  await rate(page, "Pelayanan", 5);
  await rate(page, "Kebersihan", 4);
  await rate(page, "Bahan dan alat", 4);
  await page.getByLabel("Cerita Anda").fill(text);
  await page.getByLabel("Tahun").selectOption({ index: 2 });
  await page.getByLabel("Bulan", { exact: true }).selectOption("01");
  await page.getByLabel("Nama yang ditampilkan").fill("Siti R.");
  await page.getByLabel("Ini pengalaman saya sendiri, saya tulis dengan jujur.").check();
  await page.getByLabel("Tulisan dan foto saya tidak memuat data pribadi orang lain.").check();
}

test("fix before submit: shows the flagged sentence and reason, then sends the fixed Testimony", async ({ page }) => {
  // The submit API is answered here (no Firebase sign-in in browser tests), as Moderation would.
  const sentTexts: string[] = [];
  await page.route("**/api/testimonies", async (route) => {
    const json = route.request().postDataBuffer()?.toString("latin1") ?? "";
    sentTexts.push(json.includes("0812-3456-7890") ? "phone" : "fixed");
    if (sentTexts.length === 1) {
      await route.fulfill({
        json: {
          status: "needsAuthorFix",
          message: "Mohon hapus nomor telepon sebelum mengirim.",
          text: PHONE_TEXT,
          ruleCodes: ["r1_personal_data"],
          flaggedSpans: [{ start: 30, end: 44, text: "0812-3456-7890", ruleCode: "r1_personal_data" }],
          roundsLeft: 2,
        },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      json: { testimonyId: "t-1", status: "published", message: "Terima kasih!", verifiedVisit: false },
    });
  });

  await fillForm(page, PHONE_TEXT);
  await page.getByRole("button", { name: "Kirim" }).click();

  const panel = page.getByRole("alert");
  await expect(panel).toContainText("Sedikit perbaikan sebelum terkirim");
  await expect(panel.getByRole("blockquote")).toHaveText("Hubungi saja 0812-3456-7890 untuk janji.");
  await expect(panel.locator("mark")).toHaveText("0812-3456-7890");
  await expect(panel).toContainText("Berisi data pribadi");
  await expect(panel).toContainText("Anda masih bisa memperbaiki 2 kali lagi.");
  await expect(page.getByLabel("Cerita Anda")).toHaveAttribute("aria-invalid", "true");
  await noHorizontalScroll(page);

  await page.getByLabel("Cerita Anda").fill("Dokternya sabar dan ruangannya bersih.");
  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByRole("heading", { name: "Testimoni Anda sudah terbit" })).toBeVisible();
  expect(sentTexts).toEqual(["phone", "fixed"]);
});

test("held: shows the plain reason and the 24-hour target", async ({ page }) => {
  await page.route("**/api/testimonies", (route) =>
    route.fulfill({
      status: 201,
      json: {
        testimonyId: "t-2",
        status: "held",
        message:
          "Pemeriksaan otomatis kami belum bisa menyelesaikannya. Tim FindYourDent akan memutuskan dalam 24 jam.",
        verifiedVisit: false,
      },
    }),
  );

  await fillForm(page, "Dokternya sabar dan ruangannya bersih.");
  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByRole("heading", { name: "Testimoni Anda sedang ditinjau" })).toBeVisible();
  await expect(page.getByText("Tim FindYourDent akan memutuskan dalam 24 jam.")).toBeVisible();
});

/** The answer for a Listed Provider, as RSGM UNAIR's page gets on findyourdent.com. */
const LISTED = {
  listed: true,
  name: "Klinik Gigi Senyum Contoh",
  region: { provinceCode: "35", regencyCode: "35.78" },
};

/** Fills everything but the Provider, as a Patient who came from a Provider page does. */
async function fillAfterProvider(page: Page) {
  await rate(page, "Pelayanan", 5);
  await rate(page, "Kebersihan", 4);
  await rate(page, "Bahan dan alat", 4);
  await page.getByLabel("Cerita Anda").fill("Dokternya sabar dan ruangannya bersih.");
  await page.getByLabel("Tahun").selectOption({ index: 2 });
  await page.getByLabel("Bulan", { exact: true }).selectOption("01");
  await page.getByLabel("Nama yang ditampilkan").fill("Siti R.");
  await page.getByLabel("Ini pengalaman saya sendiri, saya tulis dengan jujur.").check();
  await page.getByLabel("Tulisan dan foto saya tidak memuat data pribadi orang lain.").check();
}

test("Kirim pressed while the place is still being checked waits for the check, then sends", async ({ page }) => {
  let answer: () => void = () => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  let asked: () => void = () => {};
  const askedOnce = new Promise<void>((resolve) => {
    asked = resolve;
  });
  await page.route("**/api/providers/*/listing", async (route) => {
    asked();
    await answered;
    await route.fulfill({ json: LISTED });
  });
  let sent = 0;
  await page.route("**/api/testimonies", (route) => {
    sent += 1;
    return route.fulfill({
      status: 201,
      json: { testimonyId: "t-3", status: "published", message: "Terima kasih!", verifiedVisit: false },
    });
  });

  await page.goto("/ceritakan?placeId=sample-klinik-senyum");
  // The check starts once the form has hydrated, so what is filled from here stays.
  await askedOnce;
  await expect(page.getByText("Memeriksa tempat…")).toBeVisible();
  await fillAfterProvider(page);

  // Still checking: Kirim waits instead of refusing the name and Region it has not shown.
  const kirim = page.getByRole("button", { name: "Kirim" });
  await expect(kirim).toBeDisabled();
  const pressed = kirim.click();
  await page.waitForTimeout(300);
  await expect(page.getByText("Periksa kembali isian yang ditandai.")).toHaveCount(0);
  answer();
  await pressed;

  await expect(page.getByRole("heading", { name: "Testimoni Anda sudah terbit" })).toBeVisible();
  expect(sent).toBe(1);
});

test("a failed place check shows its retry, not errors on hidden fields", async ({ page }) => {
  let fail = true;
  await page.route("**/api/providers/*/listing", (route) =>
    fail ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.fulfill({ json: LISTED }),
  );

  await page.goto("/ceritakan?placeId=sample-klinik-senyum");
  await expect(page.getByText("Tempat belum bisa diperiksa.")).toBeVisible();
  await fillAfterProvider(page);

  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Periksa kembali isian yang ditandai." })).toBeVisible();
  // The marked field is the place check itself, with its retry.
  await expect(page.getByText("Tekan Coba lagi untuk memeriksa tempat.")).toBeVisible();
  await expect(page.getByText("Isi nama tempat sesuai papan nama atau yang Anda kenal.")).toHaveCount(0);
  await noHorizontalScroll(page);

  fail = false;
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.getByText("Tempat ini sudah terdaftar di FindYourDent.")).toBeVisible();
  await expect(page.getByText("Tekan Coba lagi untuk memeriksa tempat.")).toHaveCount(0);
});
