// Listed Provider aggregates (spec 03, amended by spec 09): recomputed from the
// published Testimonies whenever one enters or leaves `published` or its proof result
// changes. Only Proven Testimonies (verifiedVisit) feed averages and price stats.
// Pure; the Firestore side is in testimonies.server.ts.

import type {
  PaymentMethodCounts,
  ProcedurePriceAggregate,
  ProviderAggregates,
  TestimonyContent,
  TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { MIN_PROVEN_FOR_SCORE } from "../lib/scores.ts";

export type AggregateInput = Pick<TestimonyContent, "ratings" | "procedureCode" | "pricePaidRupiah" | "paymentMethod"> &
  Pick<TestimonyDoc, "verifiedVisit">;

const twoDecimals = (value: number) => Math.round(value * 100) / 100;

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/**
 * Aggregates over the published Testimonies of one Provider: every one is counted, but
 * only Proven Testimonies move the averages and price stats, and the averages stay null
 * below MIN_PROVEN_FOR_SCORE of them.
 */
export function computeAggregates(published: readonly AggregateInput[]): ProviderAggregates {
  const sum = { service: 0, hygiene: 0, materialsEquipment: 0 };
  const prices = new Map<string, number[]>();
  const paymentMethodCounts: PaymentMethodCounts = { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} };
  let verifiedVisitCount = 0;
  for (const testimony of published) {
    const payment = testimony.paymentMethod;
    if (payment?.method === "pribadi" || payment?.method === "bpjs") paymentMethodCounts[payment.method] += 1;
    else if (payment?.method === "asuransi") {
      paymentMethodCounts.asuransi += 1;
      paymentMethodCounts.insurers[payment.insurer] = (paymentMethodCounts.insurers[payment.insurer] ?? 0) + 1;
    }
    if (!testimony.verifiedVisit) continue;
    verifiedVisitCount += 1;
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
    verifiedVisitCount,
    averages:
      verifiedVisitCount < MIN_PROVEN_FOR_SCORE
        ? null
        : {
            service: twoDecimals(sum.service / verifiedVisitCount),
            hygiene: twoDecimals(sum.hygiene / verifiedVisitCount),
            materialsEquipment: twoDecimals(sum.materialsEquipment / verifiedVisitCount),
          },
    procedurePrices,
    paymentMethodCounts,
  };
}
