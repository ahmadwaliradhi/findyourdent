import { expect, seedProvider, seedTestimony, test } from "./seeded";

// Spec 09: every published Testimony carries "Kunjungan terbukti" or "Belum terbukti",
// and a Provider with fewer than three Proven Testimonies shows no star average.

const UNDER_MINIMUM = {
  testimonyCount: 2,
  verifiedVisitCount: 1,
  averages: null,
  procedurePrices: {} as never,
};

test("the Provider page labels each Testimony and shows no average below three Proven Testimonies", async ({
  page,
  firestore,
  unique,
}) => {
  const provider = await seedProvider(firestore, {
    placeId: `proof-${unique}`,
    name: `Klinik Bukti ${unique}`,
    aggregates: UNDER_MINIMUM,
  });
  await seedTestimony(firestore, provider, { displayName: "Pasien Terbukti", verifiedVisit: true });
  await seedTestimony(firestore, provider, { displayName: "Pasien Biasa", verifiedVisit: false });

  await page.goto(`/tempat/${provider.placeId}`);

  await expect(page.getByText("Belum cukup testimoni terbukti")).toBeVisible();
  await expect(page.getByText("1 testimoni terbukti", { exact: false })).toBeVisible();
  const proven = page.getByRole("article", { name: "Pasien Terbukti" });
  await expect(proven.getByText("Kunjungan terbukti")).toBeVisible();
  const unproven = page.getByRole("article", { name: "Pasien Biasa" });
  await expect(unproven.getByRole("link", { name: /Belum terbukti/ })).toHaveAttribute("href", "/verifikasi-testimoni");
});

test("the Directory row shows the count of Proven Testimonies instead of scores", async ({
  page,
  firestore,
  unique,
}) => {
  const name = `Klinik Direktori Bukti ${unique}`;
  await seedProvider(firestore, { placeId: `proof-dir-${unique}`, name, aggregates: UNDER_MINIMUM });

  await page.goto(`/direktori?q=${encodeURIComponent(name)}`);

  const row = page.locator("li", { hasText: name });
  await expect(row.getByText("Belum cukup testimoni terbukti")).toBeVisible();
  await expect(row.getByText("1 testimoni terbukti", { exact: false })).toBeVisible();
});
