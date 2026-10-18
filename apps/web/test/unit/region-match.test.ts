import { describe, expect, it } from "vitest";
import { matchRegion } from "../../app/lib/region-match.ts";
import { districtsOf } from "../../app/server/districts.server.ts";

const SURABAYA = districtsOf("35.78") ?? [];

describe("Region suggestion from a picked place's address", () => {
  it("matches the province, the kota and the kecamatan of a full address", () => {
    expect(matchRegion("Jl. Contoh No. 2, Darmo, Kec. Wonokromo, Kota Surabaya, Jawa Timur 60241", SURABAYA)).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
      districtCode: "35.78.04",
    });
  });

  it("matches the kota only when no part of the address is one of its kecamatan", () => {
    expect(matchRegion("Jl. Raya Darmo No. 1, Darmo, Surabaya, Jawa Timur", SURABAYA)).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
    });
  });

  it("suggests no kecamatan until the kecamatan of the kota are given", () => {
    expect(matchRegion("Kec. Wonokromo, Kota Surabaya, Jawa Timur")).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
    });
  });

  it("leaves the kecamatan empty when the address names two", () => {
    expect(matchRegion("Jl. Contoh No. 3, Gubeng, Wonokromo, Surabaya, Jawa Timur", SURABAYA)).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
    });
    expect(matchRegion("Kec. Gubeng, Kec. Wonokromo, Surabaya, Jawa Timur", SURABAYA)).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
    });
  });

  it("trusts a part marked Kec. over a bare kelurahan named like another kecamatan", () => {
    expect(matchRegion("Jl. Contoh, Gubeng, Kec. Wonokromo, Surabaya, Jawa Timur", SURABAYA)).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
      districtCode: "35.78.04",
    });
  });

  it("does not read the part naming the kabupaten as its kecamatan of the same name", () => {
    const sleman = districtsOf("34.04") ?? [];
    expect(matchRegion("Jl. Kaliurang, Sleman, Daerah Istimewa Yogyakarta", sleman)).toEqual({
      provinceCode: "34",
      regencyCode: "34.04",
    });
    expect(matchRegion("Jl. Kaliurang, Kec. Sleman, Kabupaten Sleman, Daerah Istimewa Yogyakarta", sleman)).toEqual({
      provinceCode: "34",
      regencyCode: "34.04",
      districtCode: "34.04.13",
    });
  });

  it("leaves the kota and kecamatan empty when the kota name fits both a kota and a kabupaten", () => {
    expect(matchRegion("Jl. Ijen No. 5, Malang, Jawa Timur", SURABAYA)).toEqual({ provinceCode: "35" });
  });

  it("suggests nothing for an address naming no known region", () => {
    expect(matchRegion("Jl. Contoh No. 1, Atlantis", SURABAYA)).toEqual({});
    expect(matchRegion("", SURABAYA)).toEqual({});
  });

  it("suggests nothing below a province the address does not name", () => {
    expect(matchRegion("Jl. Contoh No. 1, Kec. Gubeng, Surabaya", SURABAYA)).toEqual({});
  });

  it("reads mixed case and the Kota, Kabupaten and Kab. prefixes", () => {
    expect(matchRegion("KOTA malang, JAWA timur")).toEqual({ provinceCode: "35", regencyCode: "35.73" });
    expect(matchRegion("Kab. Malang, Jawa Timur")).toEqual({ provinceCode: "35", regencyCode: "35.07" });
    expect(matchRegion("Kabupaten Bogor, Jawa Barat 16911")).toEqual({ provinceCode: "32", regencyCode: "32.01" });
    expect(matchRegion("Kota Jakarta Pusat, Daerah Khusus Ibukota Jakarta")).toEqual({
      provinceCode: "31",
      regencyCode: "31.71",
    });
  });

  it("reads the English names Google gives in English", () => {
    expect(matchRegion("Jl. Contoh No. 2, Surabaya, East Java, Indonesia")).toEqual({
      provinceCode: "35",
      regencyCode: "35.78",
    });
    expect(matchRegion("Bogor Regency, West Java")).toEqual({ provinceCode: "32", regencyCode: "32.01" });
  });
});
