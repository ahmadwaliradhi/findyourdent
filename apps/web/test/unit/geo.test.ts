import { describe, expect, it } from "vitest";
import { haversineKm } from "../../app/lib/geo.ts";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: -6.2, lng: 106.8 }, { lat: -6.2, lng: 106.8 })).toBe(0);
  });

  it("measures one degree of longitude on the equator as about 111.19 km", () => {
    expect(haversineKm({ lat: 0, lng: 106 }, { lat: 0, lng: 107 })).toBeCloseTo(111.19, 1);
  });

  it("puts Monas about 116 km from Gedung Sate in Bandung", () => {
    const monas = { lat: -6.1754, lng: 106.8272 };
    const gedungSate = { lat: -6.9025, lng: 107.6188 };
    const km = haversineKm(monas, gedungSate);
    expect(km).toBeGreaterThan(114);
    expect(km).toBeLessThan(120);
  });
});
