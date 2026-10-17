import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * What a page showed, kept per history entry in this tab's JavaScript memory only:
 * never in sessionStorage, localStorage or history.state. Going Back to the entry
 * (a client-side navigation) shows it again with no new Guidance or Places call; a
 * reload or a new tab starts empty. It holds Google facts only the way React state
 * does, and only briefly, so nothing from Google is stored (spec 02).
 *
 * A few first-party strings that rebuild the page after a reload (the signed Guidance
 * token, whether the Shortlist was open) go to sessionStorage instead, through
 * keepAcrossReload. Never the complaint, a location, a typed area or anything from Google.
 */
const memory = new Map<string, { value: unknown; savedAt: number }>();
/** Enough for a Patient's back-and-forth; the oldest entries go first. */
const MAX_SLOTS = 30;
/** Older than this, the entry shows nothing and the Patient asks again, so hours and ratings stay fresh. */
const MAX_AGE_MS = 30 * 60 * 1000;

function slotKey(entryKey: string, slot: string): string {
  return `${entryKey}:${slot}`;
}

export function recallEntry<T>(entryKey: string, slot: string): T | undefined {
  settleCarry(entryKey);
  const key = slotKey(entryKey, slot);
  const saved = memory.get(key);
  if (!saved) return undefined;
  if (Date.now() - saved.savedAt > MAX_AGE_MS) {
    memory.delete(key);
    return undefined;
  }
  return saved.value as T;
}

export function rememberEntry(entryKey: string, slot: string, value: unknown): void {
  put(slotKey(entryKey, slot), { value, savedAt: Date.now() });
}

function put(key: string, saved: { value: unknown; savedAt: number }): void {
  memory.delete(key);
  memory.set(key, saved);
  while (memory.size > MAX_SLOTS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * `current` when there is one (and remembers it for this history entry), else what
 * this entry last remembered under `slot`.
 */
export function useEntryMemory<T>(slot: string, current: T | null | undefined): T | undefined {
  const { key } = useLocation();
  useEffect(() => {
    if (current != null) rememberEntry(key, slot, current);
  }, [key, slot, current]);
  return current ?? recallEntry<T>(key, slot);
}

const STORAGE_PREFIX = "fyd:entry:";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Kept for this history entry in sessionStorage, so it survives a reload or a discarded tab. Null forgets it. */
export function keepAcrossReload(entryKey: string, slot: string, value: string | null): void {
  const key = STORAGE_PREFIX + slotKey(entryKey, slot);
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Full or blocked storage only costs the Patient the card after a reload.
  }
}

export function recallAcrossReload(entryKey: string, slot: string): string | undefined {
  settleCarry(entryKey);
  try {
    return storage()?.getItem(STORAGE_PREFIX + slotKey(entryKey, slot)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The entry whose slots go to the next new entry: set when the language toggle posts. */
let carryFrom: string | null = null;

/**
 * The language toggle redirects to the same page as a new history entry; the slots of
 * the entry it left move along to it, so the Guidance card stays. Copied on the first
 * read from another entry, which is the render of the redirected page.
 */
export function carryEntryToNext(entryKey: string): void {
  carryFrom = entryKey;
}

/** The toggle's navigation is over (landed or failed): nothing waits to be carried any more. */
export function dropCarry(): void {
  carryFrom = null;
}

function settleCarry(entryKey: string): void {
  if (carryFrom === null || carryFrom === entryKey) return;
  const from = slotKey(carryFrom, "");
  carryFrom = null;
  for (const [key, saved] of [...memory]) {
    if (key.startsWith(from)) put(slotKey(entryKey, key.slice(from.length)), saved);
  }
  const stored = storage();
  if (!stored) return;
  try {
    for (const key of Object.keys(stored)) {
      if (!key.startsWith(STORAGE_PREFIX + from)) continue;
      const value = stored.getItem(key);
      const slot = key.slice((STORAGE_PREFIX + from).length);
      if (value !== null) stored.setItem(STORAGE_PREFIX + slotKey(entryKey, slot), value);
    }
  } catch {
    // As in keepAcrossReload.
  }
}
