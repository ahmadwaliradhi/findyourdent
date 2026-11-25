import { expect, seedProvider, seedTestimony, test } from "./seeded";

// Spec 07: the Provider page's "Cara bayar pasien" block. The counts come from the
// Provider's stored aggregates (recomputed on publish; covered by the API tests), so the
// specs seed them and check what the page says.

test("the Provider page shows how patients paid, from one Testimony, with the FKTP note", async ({
  page,
  firestore,
  unique,
}) => {
  const provider = await seedProvider(firestore, {
    placeId: `bayar-${unique}`,
    name: `Klinik Bayar ${unique}`,
    aggregates: {
      testimonyCount: 3,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {} as never,
      paymentMethodCounts: { pribadi: 1, bpjs: 1, asuransi: 1, insurers: { prudential: 1 } },
    },
  });
  await seedTestimony(firestore, provider, { paymentMethod: { method: "bpjs" } });

  await page.goto(`/tempat/${provider.placeId}`);

  const block = page.getByTestId("payment-counts");
  await expect(block.getByRole("heading", { name: "Cara bayar pasien" })).toBeVisible();
  await expect(block.getByText("1 pasien bayar sendiri")).toBeVisible();
  await expect(block.getByText("1 pasien bayar pakai BPJS")).toBeVisible();
  await expect(block.getByText("1 pasien bayar pakai asuransi swasta")).toBeVisible();
  await expect(block.getByText("Prudential: 1 pasien")).toBeVisible();
  await expect(block.getByText(/FKTP tempat peserta terdaftar/)).toBeVisible();
  await expect(block.getByRole("link", { name: /penjelasan BPJS dan FKTP/ })).toHaveAttribute("href", "/bpjs#fktp");
  // The wording is about the author's own visit, never "accepts BPJS".
  await expect(page.getByText(/menerima BPJS|terima BPJS/i)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the FKTP link opens the BPJS page at its FKTP section", async ({ page, firestore, unique }) => {
  const provider = await seedProvider(firestore, { placeId: `bayar-fktp-${unique}`, name: `Klinik FKTP ${unique}` });

  await page.goto(`/tempat/${provider.placeId}`);
  await page.getByTestId("fktp-note").getByRole("link", { name: /penjelasan BPJS dan FKTP/ }).click();

  await expect(page).toHaveURL(/\/bpjs#fktp$/);
  await expect(page.getByRole("heading", { level: 1, name: "BPJS Kesehatan dan perawatan gigi" })).toBeVisible();
  await expect(page.locator("#fktp")).toBeVisible();
  await expect(page.getByText(/menerima BPJS|terima BPJS/i)).toHaveCount(0);
});

test("only the methods that were reported are listed", async ({ page, firestore, unique }) => {
  const provider = await seedProvider(firestore, {
    placeId: `bayar-satu-${unique}`,
    name: `Klinik Satu Cara ${unique}`,
    aggregates: {
      testimonyCount: 2,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {} as never,
      paymentMethodCounts: { pribadi: 2, bpjs: 0, asuransi: 0, insurers: {} },
    },
  });

  await page.goto(`/tempat/${provider.placeId}`);

  const block = page.getByTestId("payment-counts");
  await expect(block.getByText("2 pasien bayar sendiri")).toBeVisible();
  await expect(block.getByText(/pakai BPJS/)).toHaveCount(0);
  await expect(block.getByText("Asuransi yang disebut")).toHaveCount(0);
});

test("a Provider nobody has reported on says so, with the FKTP note still there", async ({
  page,
  firestore,
  unique,
}) => {
  const provider = await seedProvider(firestore, { placeId: `bayar-kosong-${unique}`, name: `Klinik Kosong ${unique}` });

  await page.goto(`/tempat/${provider.placeId}`);

  const block = page.getByTestId("payment-counts");
  await expect(block.getByRole("heading", { name: "Cara bayar pasien" })).toBeVisible();
  await expect(block.getByText("Belum ada pasien yang menyebutkan cara bayar.")).toBeVisible();
  await expect(block.getByTestId("fktp-note")).toBeVisible();
});
