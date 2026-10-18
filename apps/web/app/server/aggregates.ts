// Listed Provider aggregates (spec 03, spec 09): recomputed from the published
// Testimonies whenever one enters or leaves `published` or its proof result changes.
// Only Proven Testimonies move the averages and price stats (ADR-0011). Pure; the
// Firestore side is in testimonies.server.ts and server/aggregates-recompute.ts.
// Imports stay relative with `.ts`: the release recompute job runs this file unbundled.
import type {
  ProcedurePriceAggregate,
  ProviderAggregates,
  TestimonyContent,
  TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { MIN_PROVEN_TESTIMONIES } from "../lib/scores.ts";

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
  // A document written before `verifiedVisit` existed counts as not proven.
  const proven = published.filter((testimony) => testimony.verifiedVisit === true);
  const provenCount = proven.length;
  const sum = { service: 0, hygiene: 0, materialsEquipment: 0 };
  const prices = new Map<string, number[]>();
  for (const testimony of proven) {
    sum.service += testimony.ratings.service;
    sum.hygiene += testimony.ratings.hygiene;
    sum.materialsEquipment += testimony.ratings.materialsEquipment;
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
    testimonyCount: published.length,
    verifiedVisitCount: provenCount,
    averages:
      provenCount < MIN_PROVEN_TESTIMONIES
        ? null
        : {
            service: twoDecimals(sum.service / provenCount),
            hygiene: twoDecimals(sum.hygiene / provenCount),
            materialsEquipment: twoDecimals(sum.materialsEquipment / provenCount),
          },
    procedurePrices,
  };
}
