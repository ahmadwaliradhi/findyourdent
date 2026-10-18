import { describe, expect, it } from "vitest";
import { openGraphMeta } from "~/lib/seo";

describe("openGraphMeta", () => {
  it("points link previews at the brand share image on the page's own origin", () => {
    const meta = openGraphMeta({ title: "T", description: "D", url: "https://findyourdent.com/tempat/abc?x=1" });

    expect(meta).toContainEqual({ property: "og:image", content: "https://findyourdent.com/og-image.png" });
    expect(meta).toContainEqual({ property: "og:image:width", content: "1200" });
    expect(meta).toContainEqual({ property: "og:image:height", content: "630" });
    expect(meta).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
    expect(meta).toContainEqual({ name: "twitter:image", content: "https://findyourdent.com/og-image.png" });
  });
});
