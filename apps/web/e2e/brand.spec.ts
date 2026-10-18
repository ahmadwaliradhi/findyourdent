import { expect, test } from "@playwright/test";

test("every page loads Figtree from its own origin, preloaded, with the brand icons and manifest", async ({
  page,
  request,
  baseURL,
}) => {
  const fontRequests: string[] = [];
  page.on("request", (sent) => {
    if (sent.resourceType() === "font") fontRequests.push(sent.url());
  });

  await page.goto("/");

  const preload = page.locator('head link[rel="preload"][as="font"]');
  await expect(preload).toHaveAttribute("href", "/fonts/Figtree-Variable.woff2");
  await expect(preload).toHaveAttribute("type", "font/woff2");
  await expect(preload).toHaveAttribute("crossorigin", "anonymous");

  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Figtree"'))).toBe(true);
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) expect(new URL(url).origin).toBe(new URL(baseURL ?? "").origin);

  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const manifestHref = await page.locator('head link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/site.webmanifest");

  const manifest = await (await request.get("/site.webmanifest")).json();
  expect(manifest.name).toBe("FindYourDent");
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
  for (const path of ["/favicon.svg", "/apple-touch-icon.png", "/og-image.png", "/brand/wordmark.svg"]) {
    expect((await request.get(path)).ok(), path).toBe(true);
  }
});
