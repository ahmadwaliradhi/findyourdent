import districtList from "@findyourdent/contracts/data/districts.json";
import { describe, expect, it } from "vitest";
import { isValidRegion, REGENCIES, regenciesOf } from "../../app/lib/regions.ts";

describe("Region from the Kemendagri list", () => {
  it("accepts a province with one of its own kota/kabupaten", () => {
    expect(isValidRegion({ provinceCode: "35", regencyCode: "35.78" })).toBe(true);
  });

  it("refuses a kota/kabupaten from another province", () => {
    expect(isValidRegion({ provinceCode: "31", regencyCode: "35.78" })).toBe(false);
  });

  it("refuses codes that are not on the list, and a missing province or kota", () => {
    expect(isValidRegion({ provinceCode: "99", regencyCode: "99.01" })).toBe(false);
    expect(isValidRegion({ provinceCode: "35", regencyCode: "35.99" })).toBe(false);
    expect(isValidRegion({ provinceCode: "", regencyCode: "" })).toBe(false);
    expect(isValidRegion({ provinceCode: "35", regencyCode: "" })).toBe(false);
  });

  it("accepts every kecamatan of the Kemendagri list inside its own kota/kabupaten", () => {
    const provinceOf = new Map(REGENCIES.map((r) => [r.code, r.provinceCode] as const));
    const refused = districtList.districts.filter(
      (d) =>
        !isValidRegion({
          provinceCode: provinceOf.get(d.regencyCode) ?? "",
          regencyCode: d.regencyCode,
          districtCode: d.code,
        }),
    );
    expect(refused).toEqual([]);
  });

  it("checks a kecamatan for shape inside the kota, not against the kecamatan list", () => {
    expect(isValidRegion({ provinceCode: "35", regencyCode: "35.78", districtCode: "35.78.01" })).toBe(true);
    expect(isValidRegion({ provinceCode: "35", regencyCode: "35.78", districtCode: "31.71.01" })).toBe(false);
    expect(isValidRegion({ provinceCode: "35", regencyCode: "35.78", districtCode: "Gubeng" })).toBe(false);
  });

  it("refuses anything that is not a region object", () => {
    expect(isValidRegion(null as never)).toBe(false);
    expect(isValidRegion({ provinceCode: 35, regencyCode: "35.78" } as never)).toBe(false);
  });

  it("lists the kota/kabupaten of one province only", () => {
    const codes = regenciesOf("35").map((r) => r.code);
    expect(codes).toContain("35.78");
    expect(codes.every((code) => code.startsWith("35."))).toBe(true);
    expect(regenciesOf("99")).toEqual([]);
  });
});
