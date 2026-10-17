import { describe, expect, it } from "vitest";
import { normalizeName } from "../../app/lib/normalize-name.ts";

describe("normalizeName", () => {
  it("lower-cases, strips accents and punctuation, and collapses spaces", () => {
    expect(normalizeName('  KLINIK  Gígi "Sehat" & Ceria!  ')).toBe("klinik gigi sehat ceria");
    expect(normalizeName("drg. Ayu-Lestari, Sp.KG")).toBe("drg ayu lestari sp kg");
  });

  it("keeps digits and turns an all-punctuation name into an empty string", () => {
    expect(normalizeName("Klinik 24 Jam")).toBe("klinik 24 jam");
    expect(normalizeName("...")).toBe("");
  });
});
