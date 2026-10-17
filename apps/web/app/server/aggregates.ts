// Listed Provider aggregates (spec 03): recomputed from the published Testimonies
// whenever one enters or leaves `published`. Pure; the Firestore side is in
// testimonies.server.ts.
import type {
  ProcedurePriceAggregate,
  ProviderAggregates,
  TestimonyContent,
  TestimonyDoc,
} from "@findyourdent/contracts/firestore";

export type AggregateInput = Pick<TestimonyContent, "ratings" | "procedureCode" | "pricePaidRupiah"> &
  Pick<TestimonyDoc, "verifiedVisit">;

const twoDecimals = (value: number) => Math.round(value * 100) / 100;

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/** Aggregates over the published Testimonies of one Provider. */
export function computeAggregates(published: readonly AggregateInput[]): ProviderAggregates {
  const count = published.length;
  const sum = { service: 0, hygiene: 0, materialsEquipment: 0 };
  const prices = new Map<string, number[]>();
  let verifiedVisitCount = 0;
  for (const testimony of published) {
    sum.service += testimony.ratings.service;
    sum.hygiene += testimony.ratings.hygiene;
    sum.materialsEquipment += testimony.ratings.materialsEquipment;
    if (testimony.verifiedVisit) verifiedVisitCount += 1;
    if (testimony.procedureCode && typeof testimony.pricePaidRupiah === "number") {
      const list = prices.get(testimony.procedureCode) ?? [];
      list.push(testimony.pricePaidRupiah);
      prices.set(testimony.procedureCode, list);
    }
  }

  const procedurePrices: Record<string, ProcedurePriceAggregate> = {};
  for (const [code, list] of prices) {
    const sorted = [...list].sort((a, b) => a - b);
    procedurePrices[code] = {
      count: sorted.length,
      medianRupiah: median(sorted),
      minRupiah: sorted[0] as number,
      maxRupiah: sorted.at(-1) as number,
    };
  }

  return {
    testimonyCount: count,
    verifiedVisitCount,
    averages:
      count === 0
        ? null
        : {
            service: twoDecimals(sum.service / count),
            hygiene: twoDecimals(sum.hygiene / count),
            materialsEquipment: twoDecimals(sum.materialsEquipment / count),
          },
    procedurePrices,
  };
}
