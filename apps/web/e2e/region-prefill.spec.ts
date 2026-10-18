import { expect, test } from "@playwright/test";

// Region pre-fill (spec 08): picking a place that is not Listed fills Provinsi,
// Kota/Kabupaten and Kecamatan from the address the picker already showed. The fake
// Places adapter gives drg. Ani Contoh "Jl. Contoh No. 2, Darmo, Kec. Wonokromo, Kota
// Surabaya, Jawa Timur 60241", and Klinik Gigi Senyum Contoh an address with no province.

test("picking a place fills its Region from the shown address, and the Patient can change it", async ({ page }) => {
  const placesRequests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/places/") || pathname.endsWith("/google")) placesRequests.push(pathname);
  });

  await page.goto("/ceritakan");
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Tempat praktik" }).fill("drg. ani");
  const suggestion = page.getByRole("option", { name: /drg\. Ani Contoh/ });
  await expect(suggestion).toContainText("Kec. Wonokromo, Kota Surabaya, Jawa Timur");
  const requestsBeforePick = placesRequests.length;
  await suggestion.click();

  const kecamatan = page.getByLabel("Kecamatan");
  await expect(page.getByLabel("Provinsi")).toHaveValue("35");
  await expect(page.getByLabel("Kota/Kabupaten")).toHaveValue("35.78");
  await expect(kecamatan).toHaveValue("35.78.04");
  await expect(kecamatan.locator("option:checked")).toHaveText("Wonokromo");
  // The pre-fill reads the text already on screen: no further Places request.
  expect(placesRequests).toHaveLength(requestsBeforePick);

  await kecamatan.selectOption({ label: "Gubeng" });
  await expect(kecamatan).toHaveValue("35.78.08");
  await page.getByLabel("Provinsi").selectOption({ label: "Jawa Barat" });
  await expect(page.getByLabel("Kota/Kabupaten")).toHaveValue("");
  await expect(kecamatan).toBeDisabled();
  expect(placesRequests).toHaveLength(requestsBeforePick);
});

test("an address that names no province leaves the Region for the Patient to choose", async ({ page }) => {
  await page.goto("/ceritakan");
  await expect(page.getByRole("button", { name: "Kirim" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Tempat praktik" }).fill("klinik");
  await page.getByText("Klinik Gigi Senyum Contoh").click();

  await expect(page.getByLabel("Nama tempat sesuai papan nama atau yang kamu kenal")).toBeVisible();
  await expect(page.getByLabel("Provinsi")).toHaveValue("");
  await expect(page.getByLabel("Kota/Kabupaten")).toBeDisabled();
  await expect(page.getByLabel("Kecamatan")).toBeDisabled();
});
