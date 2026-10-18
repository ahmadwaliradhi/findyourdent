// Aspect score used to rank Providers (spec 02 "Testimony quality", spec 04 directory sort):
// the mean of the three aspect averages, shrunk toward the overall mean so that one
// glowing Testimony does not outrank many good ones.
import type { AspectRatings } from "@findyourdent/contracts/firestore";

export interface RatedProvider {
  /** Aspect averages over published Testimonies; null when there are none. */
  averages: AspectRatings | null;
  testimonyCount: number;
}

export interface ScorePrior {
  /** The score a Provider is pulled toward. */
  mean: number;
  /** How many Testimonies' worth of pull the prior has. */
  weight: number;
}

/**
 * Proven Testimonies a Provider needs before a star average is shown (spec 09, ADR-0011).
 * One constant for aggregates, ranking, display and the transparency page.
 */
export const MIN_PROVEN_TESTIMONIES = 3;

/** Pull of the prior, in Testimonies. */
export const DEFAULT_PRIOR_WEIGHT = 3;
/** Prior mean when no Provider is rated yet: the middle of the 1 to 5 scale. */
const SCALE_MIDPOINT = 3;

/** Mean of the three aspect averages. */
export function overallAverage(averages: AspectRatings): number {
  return (averages.service + averages.hygiene + averages.materialsEquipment) / 3;
}

/**
 * (weight * mean + n * average) / (weight + n). Null when the Provider has no
 * Testimonies: an unrated Provider has no score (it is not given the prior's),
 * and callers sort it after every rated one.
 */
export function shrunkAspectScore({ averages, testimonyCount }: RatedProvider, prior: ScorePrior): number | null {
  if (!averages || testimonyCount <= 0) return null;
  return (prior.weight * prior.mean + testimonyCount * overallAverage(averages)) / (prior.weight + testimonyCount);
}

/** The prior over a set of Providers: their overall averages weighted by Testimony count. */
export function aspectPrior(providers: Iterable<RatedProvider>, weight = DEFAULT_PRIOR_WEIGHT): ScorePrior {
  let total = 0;
  let count = 0;
  for (const { averages, testimonyCount } of providers) {
    if (!averages || testimonyCount <= 0) continue;
    total += overallAverage(averages) * testimonyCount;
    count += testimonyCount;
  }
  return { mean: count > 0 ? total / count : SCALE_MIDPOINT, weight };
}
