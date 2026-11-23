// Aspect score used to rank Providers (spec 02 "Testimony quality", spec 04 directory sort):
// the mean of the three aspect averages, shrunk toward the overall mean so that one
// glowing Testimony does not outrank many good ones.
import type { AspectRatings } from "@findyourdent/contracts/firestore";

export interface RatedProvider {
  /** Aspect averages over Proven Testimonies; null below MIN_PROVEN_FOR_SCORE of them. */
  averages: AspectRatings | null;
  /** Proven Testimonies: the only count ranking reads, so unproven ones move nothing (spec 09). */
  verifiedVisitCount: number;
}

export interface ScorePrior {
  /** The score a Provider is pulled toward. */
  mean: number;
  /** How many Proven Testimonies' worth of pull the prior has. */
  weight: number;
}

/**
 * Proven Testimonies a Provider needs before it has aspect averages (spec 09): below
 * this computeAggregates leaves them null, and every page and ranking that reads
 * `averages` shows "Belum cukup testimoni terbukti" or treats the Provider as unrated.
 */
export const MIN_PROVEN_FOR_SCORE = 3;

/** Pull of the prior, in Proven Testimonies. */
export const DEFAULT_PRIOR_WEIGHT = 3;
/** Prior mean when no Provider is rated yet: the middle of the 1 to 5 scale. */
const SCALE_MIDPOINT = 3;

/** Mean of the three aspect averages. */
export function overallAverage(averages: AspectRatings): number {
  return (averages.service + averages.hygiene + averages.materialsEquipment) / 3;
}

/**
 * (weight * mean + n * average) / (weight + n). Null when the Provider has no
 * averages: an unrated Provider has no score of its own, and rankings place it at
 * the prior mean (spec 09).
 */
export function shrunkAspectScore({ averages, verifiedVisitCount }: RatedProvider, prior: ScorePrior): number | null {
  if (!averages || verifiedVisitCount <= 0) return null;
  return (
    (prior.weight * prior.mean + verifiedVisitCount * overallAverage(averages)) / (prior.weight + verifiedVisitCount)
  );
}

/** The prior over a set of Providers: their overall averages weighted by Proven Testimony count. */
export function aspectPrior(providers: Iterable<RatedProvider>, weight = DEFAULT_PRIOR_WEIGHT): ScorePrior {
  let total = 0;
  let count = 0;
  for (const { averages, verifiedVisitCount } of providers) {
    if (!averages || verifiedVisitCount <= 0) continue;
    total += overallAverage(averages) * verifiedVisitCount;
    count += verifiedVisitCount;
  }
  return { mean: count > 0 ? total / count : SCALE_MIDPOINT, weight };
}
