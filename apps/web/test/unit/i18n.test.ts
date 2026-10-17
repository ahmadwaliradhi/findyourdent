import { describe, expect, it } from "vitest";
import en from "../../app/i18n/locales/en.json";
import id from "../../app/i18n/locales/id.json";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("locales", () => {
  it("id and en have identical key sets", () => {
    expect(keys(en).sort()).toEqual(keys(id).sort());
  });

  it("has no empty strings", () => {
    const empty = (obj: unknown) =>
      keys(obj).filter((k) => k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], obj) === "");
    expect(empty(id)).toEqual([]);
    expect(empty(en)).toEqual([]);
  });
});
