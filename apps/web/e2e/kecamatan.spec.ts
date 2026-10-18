import { expect, type Page, test } from "@playwright/test";
import type { Firestore } from "firebase-admin/firestore";
import { test as seeded, seedProvider, seedTestimony } from "./seeded";
import { filterSection, openFilters } from "./support";

// The Kecamatan level of the Region fields (spec 08): the select waits for a
// kota/kabupaten, lists its kecamatan by name, and narrows the page to one. The listing
// specs run on the emulator-backed server with a Provider in Gambir and one in Menteng,
// both in Jakarta Pusat, so the narrowing shows on the page.

const GAMBIR = { provinceCode: "31", regencyCode: "31.71", districtCode: "31.71.01" };
const MENTENG = { provinceCode: "31", regencyCode: "31.71", districtCode: "31.71.06" };

async function seedGambirAndMenteng(firestore: Firestore, unique: string) {
  return {
    inGambir: await seedProvider(firestore, {
      placeId: `gambir-${unique}`,
      name: `Klinik Gambir ${unique}`,
      region: GAMBIR,
    }),
    inMenteng: await seedProvider(firestore, {
      placeId: `menteng-${unique}`,
      name: `Klinik Menteng ${unique}`,
      region: MENTENG,
    }),
  };
}

async function chooseKota(page: Page) {
  // A choice racing hydration can be lost (the kota select then stays disabled); choose again until it lands.
  await expect(async () => {
    await page.getByLabel("Provinsi").selectOption({ label: "Daerah Khusus Ibukota Jakarta" });
    await expect(page.getByLabel("Kota/Kabupaten")).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("Kota/Kabupaten").selectOption({ label: "Kota Administrasi Jakarta Pusat" });
}

seeded(
  "Directory: Kecamatan waits for a kota/kabupaten, then narrows the directory to one",
  async ({ page, firestore, unique }) => {
    const { inGambir, inMenteng } = await seedGambirAndMenteng(firestore, unique);

    await page.goto("/direktori?provinsi=31&kota=31.71");
    await expect(page.getByText(inGambir.name)).toBeVisible();
    await expect(page.getByText(inMenteng.name)).toBeVisible();

    await page.goto("/direktori");
    // Below desktop width the directory filters sit folded under "Filter" until one is applied.
    await openFilters(page);
    const kecamatan = page.getByLabel("Kecamatan");
    await expect(kecamatan).toBeDisabled();
    await expect(kecamatan.locator("option:checked")).toHaveText("Pilih kota/kabupaten dulu");

    await chooseKota(page);
    await expect(kecamatan).toBeEnabled();
    await expect(kecamatan.locator("option:checked")).toHaveText("Semua kecamatan");
    await kecamatan.selectOption({ label: "Gambir" });
    await page.getByRole("button", { name: "Terapkan" }).click();

    await expect(page).toHaveURL(/kecamatan=31\.71\.01/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Tempat perawatan gigi di Gambir, Kota Administrasi Jakarta Pusat",
    );
    await expect(page.getByLabel("Kecamatan")).toHaveValue("31.71.01");
    await expect(page.getByText(inGambir.name)).toBeVisible();
    await expect(page.getByText(inMenteng.name)).toHaveCount(0);

    // A new province drops the kota, and with it the kecamatan.
    await page.getByLabel("Provinsi").selectOption({ label: "Jawa Barat" });
    await expect(page.getByLabel("Kecamatan")).toBeDisabled();
  },
);

seeded("Home: the feed filter's Kecamatan narrows the Testimonies to one", async ({ page, firestore, unique }) => {
  const { inGambir, inMenteng } = await seedGambirAndMenteng(firestore, unique);
  const gambirText = `Cerita dari Gambir ${unique}: dokternya sabar dan ruangannya bersih.`;
  const mentengText = `Cerita dari Menteng ${unique}: antrenya singkat dan biayanya jelas.`;
  await seedTestimony(firestore, inGambir, { text: gambirText, publishedAt: new Date() });
  await seedTestimony(firestore, inMenteng, { text: mentengText, publishedAt: new Date() });

  await page.goto("/?provinsi=31&kota=31.71");
  await expect(page.getByText(gambirText)).toBeVisible();
  await expect(page.getByText(mentengText)).toBeVisible();

  await page.goto("/");
  // The feed filters sit folded under "Filter" until a filter is applied.
  await filterSection(page).locator("summary").click();
  await expect(page.getByLabel("Kecamatan")).toBeDisabled();
  await chooseKota(page);
  await page.getByLabel("Kecamatan").selectOption({ label: "Menteng" });
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page).toHaveURL(/kecamatan=31\.71\.06/);
  await expect(page.getByLabel("Kecamatan")).toHaveValue("31.71.06");
  await expect(page.getByText(mentengText)).toBeVisible();
  await expect(page.getByText(gambirText)).toHaveCount(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a kota in the URL lists its kecamatan, and the chosen one goes out with the filters", async ({ page }) => {
    await page.goto("/direktori?provinsi=31&kota=31.71");
    await page.getByLabel("Kecamatan").selectOption({ label: "Senen" });
    await page.getByRole("button", { name: "Terapkan" }).click();
    await expect(page).toHaveURL(/kecamatan=31\.71\.04/);
    await expect(page.getByLabel("Kecamatan")).toHaveValue("31.71.04");
  });
});

test("English labels name the level", async ({ page }) => {
  await page.goto("/direktori");
  await page.getByRole("button", { name: "Ganti bahasa ke English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const district = page.getByLabel("District (kecamatan)");
  await expect(district).toBeDisabled();
  await expect(district.locator("option:checked")).toHaveText("Choose a city or regency first");
});

test("Testimony form: the Kecamatan stays optional and is sent when chosen", async ({ page }) => {
  const bodies: string[] = [];
  await page.route("**/api/testimonies", async (route) => {
    bodies.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
    await route.fulfill({
      status: 201,
      json: { testimonyId: "t-3", status: "published", message: "Terima kasih!", verifiedVisit: false },
    });
  });

  await page.goto("/ceritakan");
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Tempat praktik" }).fill("klinik");
  await page.getByText("Klinik Gigi Senyum Contoh").click();
  await page.getByLabel("Nama tempat sesuai papan nama atau yang kamu kenal").fill("Klinik Senyum Gubeng");
  const kecamatan = page.getByLabel("Kecamatan");
  await expect(kecamatan).toBeDisabled();
  await page.getByLabel("Provinsi").selectOption({ label: "Jawa Timur" });
  await page.getByLabel("Kota/Kabupaten").selectOption({ label: "Kota Surabaya" });
  await expect(kecamatan).not.toHaveAttribute("required");
  await kecamatan.selectOption({ label: "Gubeng" });

  for (const aspect of ["Pelayanan", "Kebersihan", "Bahan dan alat"]) {
    await page.getByRole("group", { name: aspect }).getByRole("radio", { name: "4 dari 5" }).check({ force: true });
  }
  await page.getByLabel("Cerita Anda").fill("Dokternya sabar dan ruangannya bersih.");
  await page.getByLabel("Tahun").selectOption({ index: 2 });
  await page.getByLabel("Bulan", { exact: true }).selectOption("01");
  await page.getByLabel("Nama yang ditampilkan").fill("Siti R.");
  await page.getByLabel("Ini pengalaman saya sendiri, saya tulis dengan jujur.").check();
  await page.getByLabel("Tulisan dan foto saya tidak memuat data pribadi orang lain.").check();
  await page.getByRole("button", { name: "Kirim" }).click();

  await expect(page.getByRole("heading", { name: "Testimoni Anda sudah terbit" })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('"districtCode":"35.78.08"');
});
