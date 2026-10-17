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

  it("counts, averages each aspect to two decimals and counts Kunjungan terbukti", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(5, 4, 3), verifiedVisit: true },
      { ratings: ratings(4, 4, 2), verifiedVisit: false },
      { ratings: ratings(4, 5, 2), verifiedVisit: true },
    ]);
    expect(aggregates.testimonyCount).toBe(3);
    expect(aggregates.verifiedVisitCount).toBe(2);
    expect(aggregates.averages).toEqual({ service: 4.33, hygiene: 4.33, materialsEquipment: 2.33 });
  });

  it("gives median, min and max price per procedure, only from Testimonies with both", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "scaling", pricePaidRupiah: 300_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "scaling", pricePaidRupiah: 150_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "scaling", pricePaidRupiah: 200_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "tooth_filling", pricePaidRupiah: 100_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "tooth_filling", pricePaidRupiah: 250_001 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "tooth_extraction" },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, pricePaidRupiah: 999 },
    ]);
    expect(aggregates.procedurePrices).toEqual({
      scaling: { count: 3, medianRupiah: 200_000, minRupiah: 150_000, maxRupiah: 300_000 },
      // Even count: the mean of the middle two, rounded to the rupiah.
      tooth_filling: { count: 2, medianRupiah: 175_001, minRupiah: 100_000, maxRupiah: 250_001 },
    });
  });

  it("counts a free visit (price 0) as a price", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(3, 3, 3), verifiedVisit: false, procedureCode: "consultation", pricePaidRupiah: 0 },
    ]);
    expect(aggregates.procedurePrices).toEqual({
      consultation: { count: 1, medianRupiah: 0, minRupiah: 0, maxRupiah: 0 },
    });
  });
});
