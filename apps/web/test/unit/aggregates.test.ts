import { describe, expect, it } from "vitest";
import { computeAggregates } from "../../app/server/aggregates.ts";

const ratings = (service: number, hygiene: number, materialsEquipment: number) => ({
  service,
  hygiene,
  materialsEquipment,
});

describe("computeAggregates", () => {
  it("is empty with no published Testimonies", () => {
    expect(computeAggregates([])).toEqual({
      testimonyCount: 0,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {},
    });
  });

  it("counts every published Testimony but averages each aspect over Proven ones only, to two decimals", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(5, 4, 3), verifiedVisit: true },
      { ratings: ratings(1, 1, 1), verifiedVisit: false },
      { ratings: ratings(4, 4, 2), verifiedVisit: true },
      { ratings: ratings(4, 5, 2), verifiedVisit: true },
    ]);
    expect(aggregates.testimonyCount).toBe(4);
    expect(aggregates.verifiedVisitCount).toBe(3);
    expect(aggregates.averages).toEqual({ service: 4.33, hygiene: 4.33, materialsEquipment: 2.33 });
  });

  it("has no averages below three Proven Testimonies, however many unproven ones there are", () => {
    const unproven = Array.from({ length: 10 }, () => ({ ratings: ratings(5, 5, 5), verifiedVisit: false }));
    const twoProven = [
      ...unproven,
      { ratings: ratings(4, 4, 4), verifiedVisit: true },
      { ratings: ratings(2, 2, 2), verifiedVisit: true },
    ];
    expect(computeAggregates(twoProven)).toMatchObject({ testimonyCount: 12, verifiedVisitCount: 2, averages: null });

    const threeProven = computeAggregates([...twoProven, { ratings: ratings(3, 3, 3), verifiedVisit: true }]);
    expect(threeProven).toMatchObject({ testimonyCount: 13, verifiedVisitCount: 3 });
    expect(threeProven.averages).toEqual({ service: 3, hygiene: 3, materialsEquipment: 3 });
  });

  it("gives median, min and max price per procedure, only from Proven Testimonies with both", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "scaling", pricePaidRupiah: 300_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "scaling", pricePaidRupiah: 150_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "scaling", pricePaidRupiah: 200_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "scaling", pricePaidRupiah: 10_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "tooth_filling", pricePaidRupiah: 100_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "tooth_filling", pricePaidRupiah: 250_001 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "dental_crown", pricePaidRupiah: 5_000_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "tooth_extraction" },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, pricePaidRupiah: 999 },
    ]);
    expect(aggregates.procedurePrices).toEqual({
      scaling: { count: 3, medianRupiah: 200_000, minRupiah: 150_000, maxRupiah: 300_000 },
      // Even count: the mean of the middle two, rounded to the rupiah.
      tooth_filling: { count: 2, medianRupiah: 175_001, minRupiah: 100_000, maxRupiah: 250_001 },
    });
  });

  it("counts a free visit (price 0) as a price", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(3, 3, 3), verifiedVisit: true, procedureCode: "consultation", pricePaidRupiah: 0 },
    ]);
    expect(aggregates.procedurePrices).toEqual({
      consultation: { count: 1, medianRupiah: 0, minRupiah: 0, maxRupiah: 0 },
    });
  });
});
