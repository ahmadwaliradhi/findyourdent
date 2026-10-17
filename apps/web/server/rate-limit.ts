import { createHash } from "node:crypto";
import { COLLECTIONS, type RateLimitScope } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";

/** One counter a request must fit in: at most `limit` hits per fixed window. */
export interface RateLimitRule {
  scope: RateLimitScope;
  /** Raw App Check token, session id, uid or IP; only its salted hash is stored. */
  key: string;
  route: string;
  limit: number;
  windowSeconds: number;
}

export type RateLimitResult = { ok: true } | { ok: false; scope: RateLimitScope; retryAfterSeconds: number };

export interface RateLimiter {
  /**
   * Counts one hit against every rule, all or nothing: if any rule is already
   * at its limit, nothing is counted and the request is refused.
   */
  consume(rules: RateLimitRule[]): Promise<RateLimitResult>;
}

export interface RateLimiterOptions {
  /** Secret salt for key hashes, so stored ids cannot be reversed to an IP or token. */
  salt: string;
  /** Epoch milliseconds; tests move it forward to cross a window. */
  now?: () => number;
}

interface Window {
  id: string;
  rule: RateLimitRule;
  keyHash: string;
  start: number;
  end: number;
}

function windowsFor(rules: RateLimitRule[], salt: string, nowMs: number): Window[] {
  const nowSeconds = Math.floor(nowMs / 1000);
  return rules.map((rule) => {
    const start = nowSeconds - (nowSeconds % rule.windowSeconds);
    const keyHash = createHash("sha256").update(`${salt}:${rule.key}`).digest("hex").slice(0, 32);
    return {
      id: `${rule.scope}.${keyHash}.${rule.route}.${start}`,
      rule,
      keyHash,
      start,
      end: start + rule.windowSeconds,
    };
  });
}

function refusal(full: Window[], nowMs: number): RateLimitResult {
  const nowSeconds = Math.floor(nowMs / 1000);
  const last = full.reduce((a, b) => (b.end > a.end ? b : a));
  return { ok: false, scope: last.rule.scope, retryAfterSeconds: Math.max(1, last.end - nowSeconds) };
}

/** Fixed-window counters in the `rateLimits` collection (spec 00, docs/data-model.md). */
export function createFirestoreRateLimiter(firestore: Firestore, options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const collection = firestore.collection(COLLECTIONS.rateLimits);
  return {
    async consume(rules) {
      if (rules.length === 0) return { ok: true };
      const nowMs = now();
      const windows = windowsFor(rules, options.salt, nowMs).map((w) => ({ ...w, ref: collection.doc(w.id) }));
      return firestore.runTransaction(async (tx) => {
        const snapshots = await tx.getAll(...windows.map((w) => w.ref));
        const counted = windows.map((w, i) => ({
          ...w,
          count: (snapshots[i]?.get("count") as number | undefined) ?? 0,
        }));
        const full = counted.filter((w) => w.count >= w.rule.limit);
        if (full.length > 0) return refusal(full, nowMs);
        for (const w of counted) {
          tx.set(w.ref, {
            scope: w.rule.scope,
            keyHash: w.keyHash,
            route: w.rule.route,
            windowStart: Timestamp.fromMillis(w.start * 1000),
            windowSeconds: w.rule.windowSeconds,
            count: w.count + 1,
            expiresAt: Timestamp.fromMillis(w.end * 1000),
          });
        }
        return { ok: true } as const;
      });
    },
  };
}

/** Single-process counters for local UI work without Firebase. */
export function createMemoryRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const counts = new Map<string, { count: number; end: number }>();
  return {
    async consume(rules) {
      const nowMs = now();
      const nowSeconds = Math.floor(nowMs / 1000);
      for (const [id, entry] of counts) if (entry.end <= nowSeconds) counts.delete(id);
      const windows = windowsFor(rules, options.salt, nowMs);
      const full = windows.filter((w) => (counts.get(w.id)?.count ?? 0) >= w.rule.limit);
      if (full.length > 0) return refusal(full, nowMs);
      for (const w of windows) counts.set(w.id, { count: (counts.get(w.id)?.count ?? 0) + 1, end: w.end });
      return { ok: true };
    },
  };
}
