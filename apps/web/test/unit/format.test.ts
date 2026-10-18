import { describe, expect, it } from "vitest";
import { formatRupiah } from "../../app/lib/format";

// A no-break space keeps "Rp" and the amount on one line.
const rp = (amount: string) => `Rp\u00a0${amount}`;

describe("formatRupiah", () => {
  it("uses the Indonesian thousands separator in Indonesian", () => {
    expect(formatRupiah(450_000, "id")).toBe(rp("450.000"));
    expect(formatRupiah(1_850_000, "id")).toBe(rp("1.850.000"));
  });

  it("uses the English thousands separator in English", () => {
    expect(formatRupiah(450_000, "en")).toBe(rp("450,000"));
    expect(formatRupiah(1_850_000, "en")).toBe(rp("1,850,000"));
  });

  it("rounds to whole rupiah", () => {
    expect(formatRupiah(999.6, "id")).toBe(rp("1.000"));
  });
});
