import {
  COLLECTIONS,
  type CounterDoc,
  dailyQuotaCounterId,
  type PlacesMethod,
} from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";

/**
 * Daily paid-API counters for the adapter-side caps (spec 02). One counter per
 * Places method per Asia/Jakarta day, so the fallback triggers before Google refuses.
 */
export interface DailyQuota {
  /** Counts one call against today's counter, unless it has already reached `limit`. */
  tryConsume(method: PlacesMethod, limit: number): Promise<boolean>;
  /** Fills today's counter up to `cap`, after Google itself refused with RESOURCE_EXHAUSTED. */
  markExhausted(method: PlacesMethod, cap: number): Promise<void>;
}

export interface DailyQuotaOptions {
  /** Epoch milliseconds; tests move it across midnight. */
  now?: () => number;
}

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in Asia/Jakarta (UTC+7 all year, no daylight saving). */
export function jakartaDate(epochMs: number): string {
  return new Date(epochMs + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

function counterId(method: PlacesMethod, nowMs: number): string {
  return dailyQuotaCounterId("places", method, jakartaDate(nowMs));
}

/** One process, one set of counters: for local runs and unit tests. */
export function createMemoryDailyQuota({ now = Date.now }: DailyQuotaOptions = {}): DailyQuota {
  const counts = new Map<string, number>();
  return {
    async tryConsume(method, limit) {
      const id = counterId(method, now());
      const used = counts.get(id) ?? 0;
      if (used >= limit) return false;
      counts.set(id, used + 1);
      return true;
    },
    async markExhausted(method, cap) {
      const id = counterId(method, now());
      counts.set(id, Math.max(cap, counts.get(id) ?? 0));
    },
  };
}

/** Shared by every Cloud Run instance: `counters/quota.places.<method>.<date>`, deleted by a TTL policy. */
export function createFirestoreDailyQuota(
  firestore: Firestore,
  { now = Date.now }: DailyQuotaOptions = {},
): DailyQuota {
  const counters = firestore.collection(COLLECTIONS.counters);
  const fields = (value: number, nowMs: number): CounterDoc => ({
    value,
    updatedAt: Timestamp.fromMillis(nowMs),
    // Two days later, so a TTL sweep never deletes a counter still in use.
    expiresAt: Timestamp.fromMillis(nowMs + 2 * DAY_MS),
  });
  return {
    async tryConsume(method, limit) {
      const nowMs = now();
      const ref = counters.doc(counterId(method, nowMs));
      return firestore.runTransaction(async (tx) => {
        const used = ((await tx.get(ref)).data() as CounterDoc | undefined)?.value ?? 0;
        if (used >= limit) return false;
        tx.set(ref, fields(used + 1, nowMs));
        return true;
      });
    },
    async markExhausted(method, cap) {
      const nowMs = now();
      const ref = counters.doc(counterId(method, nowMs));
      await firestore.runTransaction(async (tx) => {
        const used = ((await tx.get(ref)).data() as CounterDoc | undefined)?.value ?? 0;
        tx.set(ref, fields(Math.max(cap, used), nowMs));
      });
    },
  };
}
