import { expect, type Locator } from "@playwright/test";
import { test as seeded, seedProvider, seedTestimony, signIn } from "./seeded";

// Attaching a Proof of Visit later from "Testimoni saya" (spec 09): the published
// Testimony stays as it is and the proof's result shows right away. The seeded server
// has no Storage emulator, so the attach call is answered here as the web service would
// after the proof decision; the decision itself is proven by the API tests.

const PDF = { name: "struk.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") };

/** Picks the proof once the page has hydrated: the picker stays disabled until then. */
async function pickProof(card: Locator, file = PDF) {
  const picker = card.getByLabel("Pilih file");
  await expect(picker).toBeEnabled();
  await picker.setInputFiles(file);
  await expect(card.getByText(file.name)).toBeVisible();
}

seeded(
  "attaches a Proof of Visit to a published Testimony and shows the result right away",
  async ({ page, firestore, unique }) => {
    const listed = await seedProvider(firestore, { placeId: `attach-${unique}`, name: `Klinik Bukti ${unique}` });
    const uid = await signIn(page, `penulis-${unique}@example.com`);
    const { id, text } = await seedTestimony(firestore, listed, { authorUid: uid });
    const sent: string[] = [];
    await page.route(`**/api/testimonies/${id}/proof`, async (route) => {
      sent.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
      await route.fulfill({
        json: { testimonyId: id, verifiedVisit: false, proof: { result: "pending" }, attemptsLeft: 2 },
      });
    });

    await page.goto("/testimoni-saya");
    const card = page.getByRole("region", { name: `Klinik Bukti ${unique}` });
    await expect(card.getByText("Sisa 3 kali kesempatan.")).toBeVisible();
    await pickProof(card);
    await card.getByRole("button", { name: "Kirim bukti" }).click();

    await expect(card.getByText(/Bukti kunjungan Anda menunggu pemeriksaan tim FindYourDent/)).toBeVisible();
    // Another proof may still replace it, with one attempt fewer.
    await expect(card.getByText("Sisa 2 kali kesempatan.")).toBeVisible();
    await expect(card.getByText(text)).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('name="proof"; filename="struk.pdf"');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  },
);

seeded(
  "an accepted proof makes the Testimony Proven and the attach control goes",
  async ({ page, firestore, unique }) => {
    const listed = await seedProvider(firestore, { placeId: `proven-${unique}`, name: `Klinik Terbukti ${unique}` });
    const uid = await signIn(page, `penulis-${unique}@example.com`);
    const { id } = await seedTestimony(firestore, listed, { authorUid: uid });
    await page.route(`**/api/testimonies/${id}/proof`, (route) =>
      route.fulfill({ json: { testimonyId: id, verifiedVisit: true, proof: { result: "accepted" }, attemptsLeft: 2 } }),
    );

    await page.goto("/testimoni-saya");
    const card = page.getByRole("region", { name: `Klinik Terbukti ${unique}` });
    await pickProof(card, { name: "struk.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
    await card.getByRole("button", { name: "Kirim bukti" }).click();

    await expect(card.getByText(/Testimoni ini ditandai Kunjungan terbukti/)).toBeVisible();
    await expect(card.getByText("Lampirkan bukti kunjungan")).toHaveCount(0);
  },
);

seeded("a refused proof shows the plain message and keeps the control", async ({ page, firestore, unique }) => {
  const listed = await seedProvider(firestore, { placeId: `refused-${unique}`, name: `Klinik Ditolak ${unique}` });
  const uid = await signIn(page, `penulis-${unique}@example.com`);
  const { id } = await seedTestimony(firestore, listed, { authorUid: uid });
  const message = "Bukti kunjungan belum bisa kami periksa sekarang. Silakan coba lagi nanti.";
  await page.route(`**/api/testimonies/${id}/proof`, (route) =>
    route.fulfill({ status: 503, json: { error: "proof_check_unavailable", message } }),
  );

  await page.goto("/testimoni-saya");
  const card = page.getByRole("region", { name: `Klinik Ditolak ${unique}` });
  await pickProof(card);
  await card.getByRole("button", { name: "Kirim bukti" }).click();

  await expect(card.getByRole("alert")).toHaveText(message);
  await expect(card.getByRole("button", { name: "Kirim bukti" })).toBeVisible();
});
