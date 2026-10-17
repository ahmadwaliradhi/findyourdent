import { describe, expect, it } from "vitest";
import { isSpotCheck } from "../../app/server/testimony-moderation.server.ts";

describe("spot-check sample", () => {
  it("samples about 10% of published decisions", () => {
    const decisions = Array.from({ length: 5000 }, () => isSpotCheck("publish", 0.1));
    const share = decisions.filter(Boolean).length / decisions.length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.12);
  });

  it("never samples a held or author-fix decision", () => {
    expect(isSpotCheck("hold", 1)).toBe(false);
    expect(isSpotCheck("authorFix", 1)).toBe(false);
  });

  it("takes every one at rate 1 and none at rate 0", () => {
    expect(isSpotCheck("publish", 1, () => 0.999)).toBe(true);
    expect(isSpotCheck("publish", 0, () => 0)).toBe(false);
  });
});
