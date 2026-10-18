import { describe, expect, it } from "vitest";
import { inferProviderType } from "../../app/lib/provider-type.ts";

describe("Provider type inference (spec 02)", () => {
  it("reads a hospital from Google's hospital type", () => {
    expect(inferProviderType({ displayName: "RS Premier", types: ["hospital", "health"] })).toBe("hospital");
  });

  it("reads a hospital from Google's general_hospital type alone", () => {
    expect(inferProviderType({ displayName: "RSUD Dr. Soetomo", types: ["general_hospital", "health"] })).toBe(
      "hospital",
    );
  });

  it("reads a Private Dentist from a drg. name", () => {
    expect(inferProviderType({ displayName: "drg. Ayu Lestari", types: ["dentist"] })).toBe("privateDentist");
  });

  it("reads a Klinik otherwise, including a dental clinic", () => {
    expect(inferProviderType({ displayName: "Klinik Gigi Senyum", types: ["dental_clinic"] })).toBe("klinik");
  });
});
