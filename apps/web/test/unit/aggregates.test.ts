import { describe, expect, it } from "vitest";
import { MIN_PROVEN_FOR_SCORE } from "../../app/lib/scores.ts";
import { computeAggregates } from "../../app/server/aggregates.ts";

const ratings = (service: number, hygiene: number, materialsEquipment: number) => ({
  service,
  hygiene,
  materialsEquipment,
});

const proven = (service: number, hygiene: number, materialsEquipment: number) => ({
  ratings: ratings(service, hygiene, materialsEquipment),
  verifiedVisit: true,
});

describe("computeAggregates", () => {
  it("is empty with no published Testimonies", () => {
    expect(computeAggregates([])).toEqual({
      testimonyCount: 0,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {},
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });
  });

  it("counts Payment Methods over all published Testimonies, Proven or not", () => {
    const base = { ratings: ratings(3, 3, 3) };
    const aggregates = computeAggregates([
      { ...base, verifiedVisit: true, paymentMethod: { method: "pribadi" } },
      { ...base, verifiedVisit: false, paymentMethod: { method: "pribadi" } },
      { ...base, verifiedVisit: false, paymentMethod: { method: "bpjs" } },
      { ...base, verifiedVisit: true, paymentMethod: { method: "asuransi", insurer: "prudential" } },
      { ...base, verifiedVisit: false, paymentMethod: { method: "asuransi", insurer: "prudential" } },
      { ...base, verifiedVisit: false, paymentMethod: { method: "asuransi", insurer: "allianz" } },
      { ...base, verifiedVisit: true, paymentMethod: { method: "tidakDisebut" } },
      { ...base, verifiedVisit: true },
    ]);
    expect(aggregates.testimonyCount).toBe(8);
    expect(aggregates.paymentMethodCounts).toEqual({
      pribadi: 2,
      bpjs: 1,
      asuransi: 3,
      insurers: { prudential: 2, allianz: 1 },
    });
  });

  it("needs three Proven Testimonies before it has averages", () => {
    expect(MIN_PROVEN_FOR_SCORE).toBe(3);
    const two = computeAggregates([proven(5, 4, 3), proven(4, 4, 2)]);
    expect(two.verifiedVisitCount).toBe(2);
    expect(two.averages).toBeNull();

    const three = computeAggregates([proven(5, 4, 3), proven(4, 4, 2), proven(4, 5, 2)]);
    expect(three.verifiedVisitCount).toBe(3);
    expect(three.averages).toEqual({ service: 4.33, hygiene: 4.33, materialsEquipment: 2.33 });
  });

  it("counts every published Testimony but averages only the Proven ones", () => {
    const aggregates = computeAggregates([
      proven(5, 4, 3),
      { ratings: ratings(1, 1, 1), verifiedVisit: false },
      proven(4, 4, 2),
      { ratings: ratings(1, 1, 1), verifiedVisit: false },
      proven(4, 5, 2),
    ]);
    expect(aggregates.testimonyCount).toBe(5);
    expect(aggregates.verifiedVisitCount).toBe(3);
    expect(aggregates.averages).toEqual({ service: 4.33, hygiene: 4.33, materialsEquipment: 2.33 });
  });

  it("has no averages from many unproven Testimonies", () => {
    const aggregates = computeAggregates(
      Array.from({ length: 10 }, () => ({ ratings: ratings(5, 5, 5), verifiedVisit: false })),
    );
    expect(aggregates.testimonyCount).toBe(10);
    expect(aggregates.verifiedVisitCount).toBe(0);
    expect(aggregates.averages).toBeNull();
  });

  it("gives median, min and max price per procedure, only from Proven Testimonies with both", () => {
    const aggregates = computeAggregates([
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "scaling", pricePaidRupiah: 300_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "scaling", pricePaidRupiah: 150_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "scaling", pricePaidRupiah: 200_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "scaling", pricePaidRupiah: 10_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "tooth_filling", pricePaidRupiah: 100_000 },
      { ratings: ratings(5, 5, 5), verifiedVisit: true, procedureCode: "tooth_filling", pricePaidRupiah: 250_001 },
      { ratings: ratings(5, 5, 5), verifiedVisit: false, procedureCode: "dental_crown", pricePaidRupiah: 1_000_000 },
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
  it("leaves a Testimony excluded by a violation out of Proven counts, averages and prices, but still counts it", () => {
    const priced = (service: number, excludedByViolation?: string) => ({
      ratings: ratings(service, service, service),
      verifiedVisit: true,
      procedureCode: "scaling",
      pricePaidRupiah: service * 100_000,
      paymentMethod: { method: "bpjs" as const },
      ...(excludedByViolation ? { excludedByViolation } : {}),
    });
    const aggregates = computeAggregates([priced(5), priced(4), priced(3), priced(1, "v1"), priced(2, "v1")]);
    expect(aggregates.testimonyCount).toBe(5);
    expect(aggregates.verifiedVisitCount).toBe(3);
    expect(aggregates.averages).toEqual({ service: 4, hygiene: 4, materialsEquipment: 4 });
    expect(aggregates.procedurePrices).toEqual({
      scaling: { count: 3, medianRupiah: 400_000, minRupiah: 300_000, maxRupiah: 500_000 },
    });
    expect(aggregates.paymentMethodCounts?.bpjs).toBe(5);
  });
});
