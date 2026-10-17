import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { AspectRatings, ProcedureCode, ProviderType } from "@findyourdent/contracts/firestore";

/**
 * Deterministic, explainable Shortlist ranking (spec 02), computed after Places
 * results are joined with Firestore by place_id. Procedure fit comes first; among
 * Providers that fit equally, a weighted score of Testimony quality, price fit and
 * distance decides, and ties go to the lower place_id. Claim status is carried for display but never read here, and paid
 * placement does not exist.
 */
export interface RankingCandidate {
  placeId: string;
  providerType: ProviderType;
  /** Display only: ranking never reads it. */
  claimStatus: "unclaimed" | "claimed";
  /** Procedures the Provider lists (published owner facts). */
  services: ProcedureCode[];
  /** null when the Patient typed an area instead of sharing a location. */
  distanceMeters: number | null;
  testimonies: { count: number; verifiedVisitCount: number; averages: AspectRatings | null };
  /** One representative rupiah price per procedure: Testimony median, else Price List midpoint. */
  prices: Partial<Record<ProcedureCode, number>>;
}

export interface RankingNeed {
  /** emergency: Hospitals only, nearest first (the emergency card). */
  purpose: "shortlist" | "emergency";
  likelyProcedures: ProcedureCode[];
  costEstimate: { procedureCode: ProcedureCode; minRupiah: number; maxRupiah: number }[];
}

export interface RankedProvider extends RankingCandidate {
  rank: number;
  /** Likely procedures this Provider is expected to handle. */
  procedureFit: ProcedureCode[];
  scores: { fit: number; testimonies: number; price: number; distance: number; total: number };
}

export const SHORTLIST_SIZE = 5;

/** After fit: Testimonies weigh most, then price and distance equally. */
const WEIGHTS = { testimonies: 0.6, price: 0.2, distance: 0.2 };
/** Pseudo-Testimonies at the overall mean added to every Provider, so one 5-star visit is not a sure win. */
const SHRINKAGE = 3;
const VERIFIED_BONUS_PER_VISIT = 0.02;
const VERIFIED_BONUS_MAX = 0.1;
/** Beyond this, distance stops counting against a Provider. */
const DISTANCE_HORIZON_METERS = 10_000;
/** Score for a factor with no data: neither helps nor hurts. */
const NEUTRAL = 0.5;
/** Prior when no candidate has a Testimony yet; every Provider gets it, so it never changes the order. */
const DEFAULT_MEAN_RATING = 4;

/** Specialist and surgical referrals: a Hospital fits; a Klinik or Private Dentist only if it lists the procedure. */
export const HOSPITAL_PROCEDURES: ReadonlySet<ProcedureCode> = new Set([
  "surgical_extraction",
  "wisdom_tooth_surgery",
  "abscess_drainage",
  "tooth_replantation",
  "oral_lesion_treatment",
]);

const DIAGNOSTIC: ReadonlySet<string> = new Set(
  procedureList.procedures.filter((p) => p.category === "diagnostic").map((p) => p.code),
);

/** Examinations and X-rays every Provider type does; they say nothing about fit. */
export function isDiagnostic(code: ProcedureCode): boolean {
  return DIAGNOSTIC.has(code);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function meanRating(ratings: AspectRatings): number {
  return (ratings.service + ratings.hygiene + ratings.materialsEquipment) / 3;
}

function procedureFit(candidate: RankingCandidate, need: RankingNeed): { score: number; fits: ProcedureCode[] } {
  if (need.purpose === "emergency") return { score: candidate.providerType === "hospital" ? 1 : 0, fits: [] };
  const relevant = need.likelyProcedures.filter((code) => !isDiagnostic(code));
  if (relevant.length === 0) return { score: 1, fits: [...need.likelyProcedures] };
  const fits: ProcedureCode[] = [];
  let total = 0;
  for (const code of relevant) {
    const handles =
      candidate.services.includes(code) || !HOSPITAL_PROCEDURES.has(code) || candidate.providerType === "hospital";
    if (handles) fits.push(code);
    total += handles ? 1 : 0.5;
  }
  return { score: total / relevant.length, fits };
}

function testimonyScore(candidate: RankingCandidate, overallMean: number): number {
  const { count, verifiedVisitCount, averages } = candidate.testimonies;
  const n = averages ? count : 0;
  const average = averages ? meanRating(averages) : overallMean;
  const shrunk = (n * average + SHRINKAGE * overallMean) / (n + SHRINKAGE);
  const bonus = Math.min(VERIFIED_BONUS_MAX, verifiedVisitCount * VERIFIED_BONUS_PER_VISIT);
  return clamp01((shrunk - 1) / 4 + bonus);
}

function priceScore(candidate: RankingCandidate, need: RankingNeed): number {
  const fits: number[] = [];
  for (const { procedureCode, minRupiah, maxRupiah } of need.costEstimate) {
    const price = candidate.prices[procedureCode];
    if (price === undefined) continue;
    const span = maxRupiah - minRupiah;
    fits.push(span > 0 ? 1 - clamp01((price - minRupiah) / span) : price <= minRupiah ? 1 : 0);
  }
  return fits.length === 0 ? NEUTRAL : fits.reduce((a, b) => a + b, 0) / fits.length;
}

function distanceScore(candidate: RankingCandidate): number {
  if (candidate.distanceMeters === null) return NEUTRAL;
  return 1 - Math.min(candidate.distanceMeters, DISTANCE_HORIZON_METERS) / DISTANCE_HORIZON_METERS;
}

/** Testimony-weighted mean rating over the candidates: the "overall mean" Testimonies shrink toward. */
function overallMeanRating(candidates: RankingCandidate[]): number {
  let sum = 0;
  let count = 0;
  for (const { testimonies } of candidates) {
    if (!testimonies.averages || testimonies.count === 0) continue;
    sum += meanRating(testimonies.averages) * testimonies.count;
    count += testimonies.count;
  }
  return count === 0 ? DEFAULT_MEAN_RATING : sum / count;
}

/** The top five, best first. */
export function rankProviders(candidates: RankingCandidate[], need: RankingNeed): RankedProvider[] {
  const pool = need.purpose === "emergency" ? candidates.filter((c) => c.providerType === "hospital") : candidates;
  const overallMean = overallMeanRating(pool);
  const scored = pool.map((candidate) => {
    const fit = procedureFit(candidate, need);
    const scores = {
      fit: fit.score,
      testimonies: testimonyScore(candidate, overallMean),
      price: need.purpose === "emergency" ? NEUTRAL : priceScore(candidate, need),
      distance: distanceScore(candidate),
    };
    const total =
      WEIGHTS.testimonies * scores.testimonies + WEIGHTS.price * scores.price + WEIGHTS.distance * scores.distance;
    // Rounded so floating-point noise cannot decide between equal Providers.
    const round = (value: number) => Math.round(value * 1e9) / 1e9;
    return { candidate, procedureFit: fit.fits, scores: { ...scores, fit: round(scores.fit), total: round(total) } };
  });
  scored.sort(
    (a, b) =>
      b.scores.fit - a.scores.fit ||
      b.scores.total - a.scores.total ||
      (a.candidate.placeId < b.candidate.placeId ? -1 : a.candidate.placeId > b.candidate.placeId ? 1 : 0),
  );
  return scored.slice(0, SHORTLIST_SIZE).map((s, i) => ({
    ...s.candidate,
    rank: i + 1,
    procedureFit: s.procedureFit,
    scores: s.scores,
  }));
}
