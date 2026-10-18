import { describe, expect, it } from "vitest";
import { formatDate, formatRupiah, formatRupiahAmount } from "../../app/lib/format";

// A no-break space keeps "Rp" and the amount on one line.
const rp = (amount: string) => `Rp ${amount}`;

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

describe("formatDate", () => {
  it("reads a YYYY-MM-DD date as day, month name and year in each language", () => {
    expect(formatDate("2026-09-12", "id")).toBe("12 September 2026");
    expect(formatDate("2026-10-01", "id")).toBe("1 Oktober 2026");
    expect(formatDate("2026-10-01", "en")).toBe("1 October 2026");
  });

  it("returns anything that is not a date unchanged", () => {
    expect(formatDate("soon", "id")).toBe("soon");
  });
});

describe("formatRupiahAmount", () => {
  it("groups the amount without the currency, as typed into a price field", () => {
    expect(formatRupiahAmount(450_000, "id")).toBe("450.000");
    expect(formatRupiahAmount(450_000, "en")).toBe("450,000");
  });
});
