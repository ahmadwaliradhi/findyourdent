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
