import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * What a page showed, kept per history entry in this tab's JavaScript memory only:
 * never in sessionStorage, localStorage or history.state. Going Back to the entry
 * (a client-side navigation) shows it again with no new Guidance or Places call; a
 * reload or a new tab starts empty. Holds Google facts the same way React state
 * does, so nothing from Google is stored (spec 02).
 */
const memory = new Map<string, unknown>();
/** Enough for a Patient's back-and-forth; the oldest entries go first. */
const MAX_SLOTS = 30;

function slotKey(entryKey: string, slot: string): string {
  return `${entryKey}:${slot}`;
}

export function recallEntry<T>(entryKey: string, slot: string): T | undefined {
  return memory.get(slotKey(entryKey, slot)) as T | undefined;
}

export function rememberEntry(entryKey: string, slot: string, value: unknown): void {
  const key = slotKey(entryKey, slot);
  memory.delete(key);
  memory.set(key, value);
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
