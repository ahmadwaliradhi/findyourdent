import { describe, expect, it } from "vitest";
import districtList from "../data/districts.json" with { type: "json" };
import procedureList from "../data/procedures.json" with { type: "json" };
import regionList from "../data/regions.json" with { type: "json" };
import {
  type DistrictList,
  isProcedureCode,
  PROCEDURE_CODES,
  PROCEDURES,
  REGIONS,
  validateDistrictList,
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

  it("matches the per-province kabupaten/kota counts in the Kepmendagri annex", () => {
    const counts = new Map<string, number>();
    for (const r of REGIONS.regencies) counts.set(r.provinceCode, (counts.get(r.provinceCode) ?? 0) + 1);
    // Lampiran A of Kepmendagri 300.2.2-2138/2025 (kabupaten + kota per province).
    const expected: Record<string, number> = {
      "11": 23,
      "12": 33,
      "13": 19,
      "14": 12,
      "15": 11,
      "16": 17,
      "17": 10,
      "18": 15,
      "19": 7,
      "21": 7,
      "31": 6,
      "32": 27,
      "33": 35,
      "34": 5,
      "35": 38,
      "36": 8,
      "51": 9,
      "52": 10,
      "53": 22,
      "61": 14,
      "62": 14,
      "63": 13,
      "64": 10,
      "65": 5,
      "71": 15,
      "72": 13,
      "73": 24,
      "74": 17,
      "75": 6,
      "76": 6,
      "81": 11,
      "82": 10,
      "91": 9,
      "92": 7,
      "93": 4,
      "94": 8,
      "95": 8,
      "96": 6,
    };
    for (const p of REGIONS.provinces) {
      expect(p.regenciesComplete, p.code).toBe(true);
      expect(counts.get(p.code), p.code).toBe(expected[p.code]);
    }
    expect(REGIONS.regencies.filter((r) => r.type === "kabupaten")).toHaveLength(416);
    expect(REGIONS.regencies.filter((r) => r.type === "kota")).toHaveLength(98);
    expect(REGIONS.complete).toBe(true);
  });
});

describe("data/districts.json", () => {
  const DISTRICTS = districtList as DistrictList;

  it("validates against its schema", () => {
    expect(validateDistrictList(districtList), JSON.stringify(validateDistrictList.errors)).toBe(true);
  });

  it("records where the list came from and when it was retrieved", () => {
    expect(DISTRICTS.source).toMatch(/300\.2\.2-2138/);
    expect(DISTRICTS.retrievedFrom).toMatch(/^https:\/\//);
    expect(DISTRICTS.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every kecamatan sits under a listed kota/kabupaten and has a unique code", () => {
    const regencies = new Set(REGIONS.regencies.map((r) => r.code));
    const codes = DISTRICTS.districts.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const d of DISTRICTS.districts) {
      expect(regencies.has(d.regencyCode), d.code).toBe(true);
      expect(d.code.startsWith(`${d.regencyCode}.`), d.code).toBe(true);
    }
  });

  it("covers every kota/kabupaten, with the national kecamatan total of Kepmendagri 300.2.2-2138/2025", () => {
    expect(new Set(DISTRICTS.districts.map((d) => d.regencyCode)).size).toBe(REGIONS.regencies.length);
    expect(DISTRICTS.districts).toHaveLength(7285);
  });

  it("has no two kecamatan with the same name inside one kota/kabupaten", () => {
    const keys = DISTRICTS.districts.map((d) => `${d.regencyCode} ${d.name.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
