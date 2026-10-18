import { describe, expect, it } from "vitest";
import { MIN_PROVEN_TESTIMONIES } from "../../app/lib/scores.ts";
import { type RankingCandidate, type RankingNeed, rankProviders } from "../../app/server/ranking.ts";

/** A Provider 2 km away with no Testimonies, no prices and no Claim; tests override what matters. */
function candidate(placeId: string, overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    placeId,
    providerType: "klinik",
    claimStatus: "unclaimed",
    services: [],
    distanceMeters: 2000,
    testimonies: { count: 0, verifiedVisitCount: 0, averages: null },
    prices: {},
    ...overrides,
  };
}

/**
 * Testimonies as the aggregates store them (spec 09): `average` over the Proven ones
 * only, null below the minimum; `count` also holds the unproven ones.
 */
function rated(proven: number, average: number, unproven = 0): RankingCandidate["testimonies"] {
  return {
    count: proven + unproven,
    verifiedVisitCount: proven,
    averages:
      proven >= MIN_PROVEN_TESTIMONIES ? { service: average, hygiene: average, materialsEquipment: average } : null,
  };
}

const ROOT_CANAL: RankingNeed = {
  purpose: "shortlist",
  likelyProcedures: ["root_canal_treatment", "dental_xray_periapical"],
  costEstimate: [{ procedureCode: "root_canal_treatment", minRupiah: 800_000, maxRupiah: 3_500_000 }],
};

const WISDOM_TOOTH_SURGERY: RankingNeed = {
  purpose: "shortlist",
  likelyProcedures: ["wisdom_tooth_surgery"],
  costEstimate: [{ procedureCode: "wisdom_tooth_surgery", minRupiah: 2_000_000, maxRupiah: 6_000_000 }],
};

const order = (ranked: { placeId: string }[]) => ranked.map((p) => p.placeId);

describe("Shortlist ranking", () => {
  it("puts a Hospital first for a surgical referral, even when a Klinik is nearer", () => {
    const ranked = rankProviders(
      [
        candidate("klinik-near", { distanceMeters: 500 }),
        candidate("hospital-far", { providerType: "hospital", distanceMeters: 3000 }),
      ],
      WISDOM_TOOTH_SURGERY,
    );

    expect(order(ranked)).toEqual(["hospital-far", "klinik-near"]);
  });

  it("keeps procedure fit first: a nearer, better-rated Klinik does not outrank a Hospital for a surgical referral", () => {
    const ranked = rankProviders(
      [
        candidate("klinik-near-loved", { testimonies: rated(12, 4.9), distanceMeters: 200 }),
        candidate("hospital-far-average", {
          providerType: "hospital",
          testimonies: rated(3, 2.5),
          distanceMeters: 8000,
        }),
      ],
      WISDOM_TOOTH_SURGERY,
    );

    expect(order(ranked)).toEqual(["hospital-far-average", "klinik-near-loved"]);
  });

  it("counts a Provider's listed services as procedure fit", () => {
    const ranked = rankProviders(
      [
        candidate("klinik-general", { distanceMeters: 500 }),
        candidate("klinik-oral-surgery", { services: ["wisdom_tooth_surgery"], distanceMeters: 3000 }),
      ],
      WISDOM_TOOTH_SURGERY,
    );

    expect(order(ranked)).toEqual(["klinik-oral-surgery", "klinik-general"]);
    expect(ranked[0]?.procedureFit).toEqual(["wisdom_tooth_surgery"]);
  });

  it("trusts many good Proven Testimonies over a few perfect ones", () => {
    const ranked = rankProviders(
      [
        candidate("few-perfect", { testimonies: rated(3, 5) }),
        candidate("many-good", { testimonies: rated(20, 4.6) }),
        candidate("many-poor", { testimonies: rated(20, 3) }),
      ],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["many-good", "few-perfect", "many-poor"]);
  });

  it("never lets unproven Testimonies change the order", () => {
    const providers = [
      candidate("a", { testimonies: rated(3, 4) }),
      candidate("b", { testimonies: rated(3, 4) }),
      candidate("c", { testimonies: rated(3, 2) }),
    ];
    const before = order(rankProviders(providers, ROOT_CANAL));

    const buzzed = providers.map((p) => (p.placeId === "b" ? { ...p, testimonies: rated(3, 4, 40) } : p));

    expect(before).toEqual(["a", "b", "c"]);
    expect(order(rankProviders(buzzed, ROOT_CANAL))).toEqual(before);
  });

  it("has no separate Kunjungan terbukti bonus: at the same score, place_id decides", () => {
    // Both sit exactly at the overall mean, so their scores tie and place_id decides.
    const ranked = rankProviders(
      [
        candidate("b-many-proven", { testimonies: rated(12, 4) }),
        candidate("a-few-proven", { testimonies: rated(3, 4) }),
      ],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["a-few-proven", "b-many-proven"]);
  });

  it("puts a Provider without a star average at the overall mean", () => {
    const ranked = rankProviders(
      [
        candidate("poor", { testimonies: rated(5, 2) }),
        // Two Proven and many unproven Testimonies: no average yet.
        candidate("no-average", { testimonies: rated(2, 5, 30) }),
        candidate("good", { testimonies: rated(5, 4.8) }),
      ],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["good", "no-average", "poor"]);
    expect(ranked[1]?.testimonies.averages).toBeNull();
  });

  it("prefers a price at the low end of the Cost Estimate", () => {
    const ranked = rankProviders(
      [
        candidate("pricey", { prices: { root_canal_treatment: 3_200_000 } }),
        candidate("affordable", { prices: { root_canal_treatment: 1_000_000 } }),
      ],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["affordable", "pricey"]);
  });

  it("breaks an otherwise even field by distance", () => {
    const ranked = rankProviders(
      [candidate("far", { distanceMeters: 6000 }), candidate("near", { distanceMeters: 800 })],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["near", "far"]);
  });

  it("ranks a fixed set of Providers in a fixed order: fit, then Testimonies, then price, then distance", () => {
    const ranked = rankProviders(
      [
        candidate("A-near-unknown", { distanceMeters: 300 }),
        candidate("B-well-rated", { testimonies: rated(8, 4.7), distanceMeters: 4000 }),
        candidate("C-cheap", { prices: { root_canal_treatment: 900_000 }, distanceMeters: 2500 }),
        candidate("D-poorly-rated-near", { testimonies: rated(10, 2.5), distanceMeters: 200 }),
        candidate("E-hospital", { providerType: "hospital", distanceMeters: 1500 }),
      ],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["B-well-rated", "C-cheap", "A-near-unknown", "E-hospital", "D-poorly-rated-near"]);
  });

  it("never lets a claimed Provider with weaker Testimonies outrank a better unclaimed one", () => {
    const ranked = rankProviders(
      [
        candidate("claimed-weaker", { claimStatus: "claimed", testimonies: rated(6, 3.8), distanceMeters: 500 }),
        candidate("unclaimed-better", { testimonies: rated(6, 4.6), distanceMeters: 500 }),
      ],
      ROOT_CANAL,
    );

    expect(order(ranked)).toEqual(["unclaimed-better", "claimed-weaker"]);
  });

  it("gives the same order whether or not a Provider has claimed its page", () => {
    const providers = [
      candidate("p1", { testimonies: rated(3, 4.2), distanceMeters: 1200 }),
      candidate("p2", { testimonies: rated(3, 4.2), distanceMeters: 1200 }),
      candidate("p3", { testimonies: rated(2, 4.0), distanceMeters: 900 }),
    ];
    const unclaimed = order(rankProviders(providers, ROOT_CANAL));

    for (const placeId of ["p1", "p2", "p3"]) {
      const withClaim = providers.map((p) => (p.placeId === placeId ? { ...p, claimStatus: "claimed" as const } : p));
      expect(order(rankProviders(withClaim, ROOT_CANAL))).toEqual(unclaimed);
    }
  });

  it("keeps only Hospitals for an emergency, nearest first", () => {
    const ranked = rankProviders(
      [
        candidate("hospital-far", { providerType: "hospital", distanceMeters: 7000 }),
        candidate("klinik-near", { distanceMeters: 300 }),
        candidate("hospital-near", { providerType: "hospital", distanceMeters: 2000 }),
      ],
      { purpose: "emergency", likelyProcedures: [], costEstimate: [] },
    );

    expect(order(ranked)).toEqual(["hospital-near", "hospital-far"]);
  });

  it("returns at most five Providers", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate(`p${String(i).padStart(2, "0")}`));

    expect(rankProviders(many, ROOT_CANAL)).toHaveLength(5);
  });
});
