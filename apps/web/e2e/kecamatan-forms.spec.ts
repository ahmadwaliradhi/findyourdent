import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { expect, test } from "@playwright/test";
import { seedApprovedClaim, test as seeded, seedProvider, signIn } from "./seeded";

// The Kecamatan in the forms that change a Listed Provider's Region (spec 08): a Listed
// Provider without one gains it through "Sarankan koreksi" or its owner's facts.

test("Sarankan koreksi offers the Kecamatan and sends the chosen one", async ({ page }) => {
  await page.route("**/api/providers/*/listing", (route) =>
    route.fulfill({
      json: { listed: true, name: "Klinik Gigi Senyum", region: { provinceCode: "35", regencyCode: "35.78" } },
    }),
  );
  const bodies: string[] = [];
  await page.route("**/api/providers/*/name-corrections", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({ status: 201, json: { correctionId: "c-1" } });
  });

  await page.goto("/ceritakan");
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Tempat praktik" }).fill("klinik");
  await page.getByText("Klinik Gigi Senyum Contoh").click();
  await page.getByRole("button", { name: "Sarankan koreksi" }).click();

  const correction = page.getByRole("region", { name: "Sarankan koreksi" });
  const kecamatan = correction.getByLabel("Kecamatan");
  await expect(kecamatan).toBeDisabled();
  await expect(kecamatan.locator("option:checked")).toHaveText("Pilih kota/kabupaten dulu");
  await correction.getByLabel("Provinsi").selectOption({ label: "Jawa Timur" });
  await correction.getByLabel("Kota/Kabupaten").selectOption({ label: "Kota Surabaya" });
  await kecamatan.selectOption({ label: "Gubeng" });
  await correction.getByRole("button", { name: "Kirim saran" }).click();

  await expect(page.getByText("Terima kasih, saran Anda sudah kami terima.")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? "{}")).toEqual({
    suggestedRegion: { provinceCode: "35", regencyCode: "35.78", districtCode: "35.78.08" },
  });
});

seeded("The owner's facts form offers the Kecamatan and saves the chosen one", async ({ page, firestore, unique }) => {
  const listed = await seedProvider(firestore, {
    placeId: `owned-${unique}`,
    name: `Klinik Pemilik ${unique}`,
    region: { provinceCode: "31", regencyCode: "31.71" },
  });
  const uid = await signIn(page, `pemilik-${unique}@example.com`);
  await seedApprovedClaim(firestore, listed.placeId, uid);

  await page.goto(`/tempat/${listed.placeId}/klaim`);
  const facts = page.getByRole("region", { name: "Data praktik" });
  const kecamatan = facts.getByLabel("Kecamatan");
  await expect(facts.getByLabel("Kota/Kabupaten")).toHaveValue("31.71");
  await expect(kecamatan).not.toHaveAttribute("required");
  await kecamatan.selectOption({ label: "Gambir" });
  await facts.getByRole("button", { name: "Simpan data" }).click();

  await expect
    .poll(async () => {
      const stored = (
        await firestore.collection(COLLECTIONS.providers).doc(listed.placeId).get()
      ).data() as ProviderDoc;
      return (stored.pendingOwnerFacts ?? stored.ownerFacts)?.region;
    })
    .toEqual({ provinceCode: "31", regencyCode: "31.71", districtCode: "31.71.01" });

  // Another kota drops the kecamatan, which belonged to the old one.
  await facts.getByLabel("Kota/Kabupaten").selectOption({ label: "Kota Administrasi Jakarta Selatan" });
  await expect(kecamatan).toHaveValue("");
  await expect(kecamatan.locator("option:checked")).toHaveText("Pilih kecamatan (opsional)");

  // Another province drops the kota too, and the Kecamatan waits for one again.
  await facts.getByLabel("Provinsi").selectOption({ label: "Jawa Timur" });
  await expect(kecamatan).toBeDisabled();
  await expect(kecamatan.locator("option:checked")).toHaveText("Pilih kota/kabupaten dulu");
});
