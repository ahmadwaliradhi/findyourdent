// Price Lists (spec 05, T18), shared by the browser and the web API. A claimed
// Provider uploads a PDF or photos, Gemini reads them into rows, the owner corrects
// and confirms them. Only confirmed rows are ever stored. Plain types only.
import type { ExtractedPriceRow, PriceUnit } from "@findyourdent/contracts";
import type { PriceListRow } from "@findyourdent/contracts/firestore";

/** Multipart field of POST /api/providers/:placeId/price-lists: one PDF, or one to five photos. */
export const PRICE_LIST_FIELDS = { files: "files" } as const;

export const PRICE_LIST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PRICE_LIST_PDF_TYPE = "application/pdf";

export const PRICE_LIST_LIMITS = {
  imagesMax: 5,
  fileMaxBytes: 10 * 1024 * 1024,
  /** Cloud Run refuses request bodies over 32 MB. */
  totalMaxBytes: 25 * 1024 * 1024,
  rowsMax: 300,
  procedureTextMax: 200,
  notesMax: 300,
  /** One billion rupiah: anything above is a misread. */
  rupiahMax: 1_000_000_000,
} as const;

export const PRICE_UNITS: readonly PriceUnit[] = ["per_tooth", "per_jaw", "per_visit", "per_package"];

/** Rows Gemini read with less confidence than this are highlighted for the owner to check. */
export const LOW_CONFIDENCE = 0.7;

/**
 * The original document is kept privately this long for disputes, then deleted by the
 * uploads bucket's lifecycle rule; keep in step with its `age` in infra/gcp/setup.sh.
 */
export const ORIGINAL_RETENTION_DAYS = 30;

/** A list confirmed longer ago than this shows "mungkin sudah berubah". */
export const STALE_AFTER_MONTHS = 12;

/** Whether a list confirmed on `confirmed` is more than twelve months old on `now`. */
export function isPossiblyOutdated(confirmed: Date, now: Date = new Date()): boolean {
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - STALE_AFTER_MONTHS);
  return confirmed.getTime() < limit.getTime();
}

/** 200 body of an upload: rows to review, or no rows and a retry message. */
export type PriceListUploadResponse =
  | { kind: "ok"; priceListId: string; rows: ExtractedPriceRow[] }
  | { kind: "failed"; message: string };

/** POST /api/providers/:placeId/price-lists/:priceListId, JSON: the rows the owner confirmed. */
export interface PriceListConfirmation {
  rows: PriceListRow[];
}

export interface PriceListConfirmResponse {
  status: "current";
  /** `YYYY-MM-DD`, Asia/Jakarta. */
  confirmedAt: string;
  message: string;
}

export interface PriceListApiError {
  error:
    | "app_check_required"
    | "rate_limited"
    | "sign_in_required"
    | "invalid_file"
    | "invalid_rows"
    | "not_owner"
    | "not_found"
    | "unavailable";
  message: string;
}

/** The current list as Patients see it on the Provider page. */
export interface PublicPriceList {
  rows: PriceListRow[];
  /** `YYYY-MM-DD`, Asia/Jakarta. */
  confirmedAt: string;
  possiblyOutdated: boolean;
}
