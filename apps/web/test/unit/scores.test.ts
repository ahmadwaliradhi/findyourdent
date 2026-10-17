import { describe, expect, it } from "vitest";
import { aspectPrior, shrunkAspectScore } from "../../app/lib/scores.ts";

const flat = (score: number) => ({ service: score, hygiene: score, materialsEquipment: score });

describe("shrunkAspectScore", () => {
  it("pulls the mean of the three aspect averages toward the prior by the prior weight", () => {
    // (3 * 4 + 2 * 5) / (3 + 2)
    expect(shrunkAspectScore({ averages: flat(5), testimonyCount: 2 }, { mean: 4, weight: 3 })).toBeCloseTo(4.4, 10);
    // aspects 4, 5, 3 average to 4; (3 * 3 + 6 * 4) / 9
    expect(
      shrunkAspectScore(
        { averages: { service: 4, hygiene: 5, materialsEquipment: 3 }, testimonyCount: 6 },
        { mean: 3, weight: 3 },
      ),
    ).toBeCloseTo(11 / 3, 10);
  });

  it("is null for a Provider without Testimonies", () => {
    expect(shrunkAspectScore({ averages: null, testimonyCount: 0 }, { mean: 4, weight: 3 })).toBeNull();
    expect(shrunkAspectScore({ averages: flat(5), testimonyCount: 0 }, { mean: 4, weight: 3 })).toBeNull();
  });

  it("ranks one perfect Testimony below many slightly lower ones", () => {
    const prior = { mean: 4.2, weight: 3 };
    const single = shrunkAspectScore({ averages: flat(5), testimonyCount: 1 }, prior);
    const many = shrunkAspectScore({ averages: flat(4.8), testimonyCount: 20 }, prior);
    expect(single).toBeCloseTo(4.4, 10);
    expect(many).toBeCloseTo(4.721739, 5);
  });
});

describe("aspectPrior", () => {
  it("is the Testimony-weighted mean over rated Providers, with weight 3 by default", () => {
    expect(
      aspectPrior([
        { averages: flat(5), testimonyCount: 1 },
        { averages: flat(4), testimonyCount: 3 },
        { averages: null, testimonyCount: 0 },
      ]),
    ).toEqual({ mean: 4.25, weight: 3 });
  });

  it("falls back to the scale midpoint when nothing is rated, and takes a custom weight", () => {
    expect(aspectPrior([], 5)).toEqual({ mean: 3, weight: 5 });
  });
});
