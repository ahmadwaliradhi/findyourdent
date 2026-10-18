// Scene 5's still: the architecture diagram from the README, rendered as a PNG for the video.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { CAPTURES_DIR } from "./scenes.ts";

test.use({
  video: "off",
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: false,
});

test("scene 5: the README architecture diagram as a PNG", async ({ page }) => {
  const readme = readFileSync(fileURLToPath(new URL("../../../README.md", import.meta.url)), "utf8");
  const diagram = readme.match(/```mermaid\n([\s\S]*?)```/)?.[1];
  if (!diagram) throw new Error("README.md has no mermaid architecture diagram");
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#fff;display:grid;place-items:center;min-height:100vh">
      <pre class="mermaid">${diagram.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
      <script type="module">
        import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
        mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { useMaxWidth: false } });
        await mermaid.run();
        document.body.dataset.rendered = "true";
      </script>
    </body></html>`,
  );
  await expect(page.locator("body[data-rendered='true'] svg")).toBeVisible();
  await page.locator("pre.mermaid").screenshot({ path: `${CAPTURES_DIR}architecture.png` });
});
