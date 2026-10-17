// Checks the JSON part of a Testimony submit body (TestimonySubmission, spec 03).
// Pure: the caller says whether the place is already a Listed Provider and passes
// the translator for the Patient's language.
import { isProcedureCode } from "@findyourdent/contracts";
import type { AspectRatings, RegionRef } from "@findyourdent/contracts/firestore";
import type { TFunction } from "i18next";
import { isValidRegion, PROVINCES } from "~/lib/regions";
import { TESTIMONY_LIMITS } from "~/lib/testimony";

/** Google place ids are URL-safe base64-ish strings. */
// Same shape the Provider page accepts (provider.server.ts).
export const PLACE_ID = /^[A-Za-z0-9_-]{4,512}$/;
const VISIT_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Older visit months are almost certainly typos. */
export const EARLIEST_VISIT_MONTH = "1980-01";

/** Provider fields: ignored for a Listed place, required for a new one, optional on edit. */
export type ProviderFieldsRule = "ignore" | "require" | "optional";

export interface CheckedSubmission {
  placeId: string;
  /** Present only when the rule is not "ignore" and the author sent one. */
  providerName?: string;
  region?: RegionRef;
  ratings: AspectRatings;
  /** Trimmed. */
  text: string;
  visitMonth: string;
  procedureCode?: string;
  pricePaidRupiah?: number;
  displayName: string;
  keepPhotoPaths: string[];
}

export type SubmissionCheck =
  | { ok: true; value: CheckedSubmission }
  | { ok: false; fieldErrors: Record<string, string> };

const provinceCodes = new Set(PROVINCES.map((p) => p.code));
const ASPECTS = ["service", "hygiene", "materialsEquipment"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The JSON field of the multipart body, or null when it is missing or not an object. */
export function parseSubmissionJson(raw: FormDataEntryValue | null): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function checkSubmission(
  input: Record<string, unknown>,
  options: { providerFields: ProviderFieldsRule; currentMonth: string; t: TFunction },
): SubmissionCheck {
  const { t } = options;
  const errors: Record<string, string> = {};

  const placeId = typeof input.placeId === "string" ? input.placeId : "";
  if (!PLACE_ID.test(placeId)) errors.placeId = t("testimonyApi.fields.placeId");

  let providerName: string | undefined;
  let region: RegionRef | undefined;
  if (options.providerFields !== "ignore") {
    const name = trimmed(input.providerName);
    const nameGiven = input.providerName !== undefined && input.providerName !== null;
    if (options.providerFields === "require" || nameGiven) {
      if (name.length < 1 || name.length > TESTIMONY_LIMITS.providerNameMaxChars) {
        errors.providerName = t("testimonyApi.fields.providerName", { max: TESTIMONY_LIMITS.providerNameMaxChars });
      } else {
        providerName = name;
      }
    }
    const regionGiven = input.region !== undefined && input.region !== null;
    if (options.providerFields === "require" || regionGiven) {
      const raw = isRecord(input.region) ? input.region : {};
      const provinceCode = typeof raw.provinceCode === "string" ? raw.provinceCode : "";
      const regencyCode = typeof raw.regencyCode === "string" ? raw.regencyCode : "";
      const districtCode =
        typeof raw.districtCode === "string" && raw.districtCode !== "" ? raw.districtCode : undefined;
      if (!provinceCodes.has(provinceCode)) {
        errors["region.provinceCode"] = t("testimonyApi.fields.provinceCode");
      } else if (!isValidRegion({ provinceCode, regencyCode })) {
        errors["region.regencyCode"] = t("testimonyApi.fields.regencyCode");
      } else if (districtCode !== undefined && !isValidRegion({ provinceCode, regencyCode, districtCode })) {
        errors["region.districtCode"] = t("testimonyApi.fields.districtCode");
      } else {
        region = { provinceCode, regencyCode, ...(districtCode ? { districtCode } : {}) };
      }
    }
  }

  const rawRatings = isRecord(input.ratings) ? input.ratings : {};
  const ratings = {} as AspectRatings;
  for (const aspect of ASPECTS) {
    const value = rawRatings[aspect];
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) {
      ratings[aspect] = value;
    } else {
      errors[`ratings.${aspect}`] = t("testimonyApi.fields.rating");
    }
  }

  const text = trimmed(input.text);
  if (text.length === 0) errors.text = t("testimonyApi.fields.text");
  else if (text.length > TESTIMONY_LIMITS.textMaxChars) {
    errors.text = t("testimonyApi.fields.textTooLong", { max: TESTIMONY_LIMITS.textMaxChars });
  }

  const visitMonth = typeof input.visitMonth === "string" ? input.visitMonth : "";
  if (!VISIT_MONTH.test(visitMonth) || visitMonth < EARLIEST_VISIT_MONTH) {
    errors.visitMonth = t("testimonyApi.fields.visitMonth");
  } else if (visitMonth > options.currentMonth) {
    errors.visitMonth = t("testimonyApi.fields.visitMonthFuture");
  }

  let procedureCode: string | undefined;
  if (input.procedureCode !== undefined && input.procedureCode !== null && input.procedureCode !== "") {
    if (typeof input.procedureCode === "string" && isProcedureCode(input.procedureCode)) {
      procedureCode = input.procedureCode;
    } else {
      errors.procedureCode = t("testimonyApi.fields.procedureCode");
    }
  }

  let pricePaidRupiah: number | undefined;
  if (input.pricePaidRupiah !== undefined && input.pricePaidRupiah !== null) {
    const price = input.pricePaidRupiah;
    if (
      typeof price === "number" &&
      Number.isInteger(price) &&
      price >= 0 &&
      price <= TESTIMONY_LIMITS.priceMaxRupiah
    ) {
      pricePaidRupiah = price;
    } else {
      errors.pricePaidRupiah = t("testimonyApi.fields.pricePaidRupiah");
    }
  }

  const displayName = trimmed(input.displayName);
  if (displayName.length < 1 || displayName.length > TESTIMONY_LIMITS.displayNameMaxChars) {
    errors.displayName = t("testimonyApi.fields.displayName", { max: TESTIMONY_LIMITS.displayNameMaxChars });
  }

  const consent = isRecord(input.consent) ? input.consent : {};
  if (consent.honestExperience !== true || consent.noOthersPersonalData !== true) {
    errors.consent = t("testimonyApi.fields.consent");
  }

  const keep = input.keepPhotoPaths;
  const keepPhotoPaths = Array.isArray(keep) && keep.every((p) => typeof p === "string") ? (keep as string[]) : [];
  if (keep !== undefined && keep !== null && keepPhotoPaths.length !== (keep as unknown[]).length) {
    errors.photos = t("testimonyApi.fields.keepPhotoPaths");
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      placeId,
      ...(providerName !== undefined ? { providerName } : {}),
      ...(region ? { region } : {}),
      ratings,
      text,
      visitMonth,
      ...(procedureCode ? { procedureCode } : {}),
      ...(pricePaidRupiah !== undefined ? { pricePaidRupiah } : {}),
      displayName,
      keepPhotoPaths: [...new Set(keepPhotoPaths)],
    },
  };
}
