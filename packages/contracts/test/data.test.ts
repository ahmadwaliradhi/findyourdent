import { describe, expect, it } from "vitest";
import procedureList from "../data/procedures.json" with { type: "json" };
import regionList from "../data/regions.json" with { type: "json" };
import {
  isProcedureCode,
  PROCEDURE_CODES,
  PROCEDURES,
  REGIONS,
  validateProcedureList,
  validateRegionList,
} from "../src/index.js";

describe("data/procedures.json", () => {
  it("validates against its schema", () => {
    expect(validateProcedureList(procedureList), JSON.stringify(validateProcedureList.errors)).toBe(true);
  });

  it("has unique codes", () => {
    expect(new Set(PROCEDURES.map((p) => p.code)).size).toBe(PROCEDURES.length);
  });

  it("covers the procedures Guidance needs", () => {
    for (const code of [
      "consultation",
      "scaling",
      "tooth_filling",
      "root_canal_treatment",
      "tooth_extraction",
      "wisdom_tooth_surgery",
      "abscess_drainage",
      "orthodontic_braces",
      "removable_denture",
    ]) {
      expect(isProcedureCode(code), code).toBe(true);
    }
    expect(isProcedureCode("not_a_procedure")).toBe(false);
    expect(PROCEDURE_CODES.size).toBe(PROCEDURES.length);
  });
});

describe("data/regions.json", () => {
  it("validates against its schema", () => {
    expect(validateRegionList(regionList), JSON.stringify(validateRegionList.errors)).toBe(true);
  });

  it("lists all 38 provinces with unique codes", () => {
    expect(REGIONS.provinces).toHaveLength(38);
    expect(new Set(REGIONS.provinces.map((p) => p.code)).size).toBe(38);
  });

  it("every regency belongs to a listed province and has a unique code", () => {
    const provinces = new Set(REGIONS.provinces.map((p) => p.code));
    const codes = REGIONS.regencies.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of REGIONS.regencies) {
      expect(provinces.has(r.provinceCode), r.code).toBe(true);
      expect(r.code.startsWith(`${r.provinceCode}.`), r.code).toBe(true);
      // Kemendagri: kabupaten use .01-.69, kota use .71 and up.
      expect(Number(r.code.slice(3)) >= 71, r.code).toBe(r.type === "kota");
    }
  });

  it("marks completeness honestly", () => {
    const counts = new Map<string, number>();
    for (const r of REGIONS.regencies) counts.set(r.provinceCode, (counts.get(r.provinceCode) ?? 0) + 1);
    const expectedComplete: Record<string, number> = {
      "31": 6,
      "32": 27,
      "33": 35,
      "34": 5,
      "35": 38,
      "36": 8,
      "51": 9,
    };
    for (const p of REGIONS.provinces) {
      expect(p.regenciesComplete, p.code).toBe(p.code in expectedComplete);
      if (p.regenciesComplete) expect(counts.get(p.code), p.code).toBe(expectedComplete[p.code]);
    }
    expect(REGIONS.complete).toBe(REGIONS.provinces.every((p) => p.regenciesComplete));
  });
});
