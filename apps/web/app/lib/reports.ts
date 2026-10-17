// Testimony reports (spec 03), shared by the Report button (browser) and the web API.
import type { ReportCategory } from "@findyourdent/contracts/firestore";

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "personalData",
  "threat",
  "falseClaim",
  "spam",
  "conflictOfInterest",
  "other",
];

/** Reports in these categories hide a published Testimony at once, until an admin decides. */
export const HIDING_CATEGORIES: ReadonlySet<ReportCategory> = new Set(["personalData", "threat"]);

export const REPORT_DETAILS_MAX_CHARS = 1000;

/** POST /api/testimonies/:testimonyId/reports, JSON. Signing in is optional. */
export interface ReportRequest {
  category: ReportCategory;
  details?: string;
}

/** 201 body. `hidden`: this report hid the Testimony. */
export interface ReportResponse {
  reportId: string;
  hidden: boolean;
}

export interface ReportApiError {
  error: "app_check_required" | "rate_limited" | "invalid_report" | "not_found" | "unavailable";
  message: string;
}

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && (REPORT_CATEGORIES as readonly string[]).includes(value);
}
