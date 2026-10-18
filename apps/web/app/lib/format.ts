import type { Language } from "~/i18n/config";

/** English keeps Indonesian separators for counts, scores and distances; money follows the language (formatRupiah). */
function locale(language: Language): string {
  return language === "id" ? "id-ID" : "en-ID";
}

/**
 * "Rp 450.000" in Indonesian, "Rp 450,000" in English: money takes the language's own thousands
 * separator. A no-break space keeps "Rp" and the amount on one line.
 */
export function formatRupiah(amount: number, language: Language): string {
  return `Rp\u00a0${formatRupiahAmount(amount, language)}`;
}

/** The amount alone, "450.000" or "450,000", for a price field labelled "(Rp)". */
export function formatRupiahAmount(amount: number, language: Language): string {
  return new Intl.NumberFormat(language === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 0 }).format(amount);
}

export function formatCount(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language)).format(value);
}

/** An aspect score or average with one decimal, "4,3". */
export function formatScore(value: number, language: Language): string {
  return new Intl.NumberFormat(locale(language), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

export function formatKm(km: number, language: Language): string {
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(km);
}

/** "2026-09" as "September 2026"; UTC so server and browser agree. */
export function formatVisitMonth(visitMonth: string, language: Language): string {
  const [year, month] = visitMonth.split("-").map(Number);
  if (!year || !month) return visitMonth;
  return new Intl.DateTimeFormat(locale(language), { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** "2026-09-12" as "12 September 2026"; UTC so server and browser agree. */
export function formatDate(date: string, language: Language): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(locale(language), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "450 m" or "1,2 km". */
export function formatDistance(meters: number, language: Language): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${formatKm(meters / 1000, language)} km`;
}
