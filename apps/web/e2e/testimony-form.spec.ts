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
  const link = page.getByRole("link", { name: "Ceritakan pengalamanmu" });
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
