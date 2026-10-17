import type { Language } from "~/i18n/config";

export function formatRupiah(amount: number, language: Language): string {
  return new Intl.NumberFormat(language === "id" ? "id-ID" : "en-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** One decimal for scores and ratings: "4,6" (Indonesian) / "4.6" (English). */
export function formatScore(value: number, language: Language): string {
  return value.toLocaleString(language === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 });
}

/** "450 m" or "1,2 km" (Indonesian) / "1.2 km" (English). */
export function formatDistance(meters: number, language: Language): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = new Intl.NumberFormat(language === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 }).format(
    meters / 1000,
  );
  return `${km} km`;
}
