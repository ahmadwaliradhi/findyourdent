import { describe, expect, it } from "vitest";
import { listingFiltersToParams, parseListingFilters } from "../../app/lib/listing-filters.ts";

const parse = (query: string) => parseListingFilters(new URLSearchParams(query));

describe("listing filters", () => {
  it("reads every filter from the URL", () => {
    expect(parse("provinsi=31&kota=31.71&kecamatan=31.71.01&prosedur=consultation&jenis=hospital&terbukti=1")).toEqual({
      provinceCode: "31",
      regencyCode: "31.71",
      districtCode: "31.71.01",
      procedureCode: "consultation",
      providerType: "hospital",
      verifiedOnly: true,
    });
  });

  it("drops unknown codes and values", () => {
    expect(parse("provinsi=99&kota=99.99&prosedur=nope&jenis=spa&terbukti=yes")).toEqual({ verifiedOnly: false });
  });

  it("derives the province from the kota and drops a kota from another province", () => {
    expect(parse("kota=31.71")).toEqual({ provinceCode: "31", regencyCode: "31.71", verifiedOnly: false });
    expect(parse("provinsi=32&kota=31.71")).toEqual({ provinceCode: "32", verifiedOnly: false });
  });

  it("keeps a kecamatan only inside its kota", () => {
    expect(parse("kota=31.71&kecamatan=32.01.01").districtCode).toBeUndefined();
    expect(parse("kecamatan=31.71.01").districtCode).toBeUndefined();
  });

  it("round-trips through URL parameters", () => {
    const query = "provinsi=31&kota=31.71&kecamatan=31.71.01&prosedur=consultation&jenis=klinik&terbukti=1";
    expect(listingFiltersToParams(parse(query)).toString()).toBe(query);
  });
});
