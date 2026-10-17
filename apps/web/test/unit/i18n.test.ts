import { describe, expect, it } from "vitest";
import { fromAcceptLanguage } from "../../app/i18n/language.server.ts";
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

describe("Accept-Language detection", () => {
  it.each([
    [null, null],
    ["en-US,en;q=0.9", "en"],
    ["id-ID,id;q=0.9,en;q=0.8", "id"],
    ["in-ID", "id"],
    ["fr-FR,en;q=0.5,id;q=0.7", "id"],
    ["fr-FR", null],
  ])("%s -> %s", (header, expected) => {
    expect(fromAcceptLanguage(header)).toBe(expected);
  });
});
