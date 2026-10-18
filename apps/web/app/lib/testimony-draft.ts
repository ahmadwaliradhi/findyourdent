// The posting form's state, its browser draft and its own checks (spec 03, user stories
// 9 to 20). Pure, so the form and the unit tests share it.

import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { AspectRatings } from "@findyourdent/contracts/firestore";
import type id from "../i18n/locales/id.json";
import { ASPECTS } from "./aspects";
import {
  EMPTY_PROVIDER_FIELDS,
  PHOTO_MIME_TYPES,
  PROOF_MIME_TYPES,
  type ProviderFieldsValue,
  TESTIMONY_LIMITS,
  type TestimonySubmission,
} from "./testimony";

export type Aspect = (typeof ASPECTS)[number];

/** Everything typed into the form. Files are kept apart: they cannot go into a draft. */
export interface TestimonyFormState {
  provider: ProviderFieldsValue;
  ratings: Record<Aspect, number | null>;
  text: string;
  procedureCode: string;
  /** Digits only; shown with thousands separators. */
  price: string;
  /** "2026" */
  visitYear: string;
  /** "09" */
  visitMonth: string;
  displayName: string;
  consentHonest: boolean;
  consentNoOthers: boolean;
}

export const EMPTY_FORM_STATE: TestimonyFormState = {
  provider: EMPTY_PROVIDER_FIELDS,
  ratings: { service: null, hygiene: null, materialsEquipment: null },
  text: "",
  procedureCode: "",
  price: "",
  visitYear: "",
  visitMonth: "",
  displayName: "",
  consentHonest: false,
  consentNoOthers: false,
};

/** localStorage key of the create-mode draft. Edits keep no draft. */
export const DRAFT_KEY = "fyd.testimonyDraft.v1";

const PROCEDURE_CODES = new Set<string>(procedureList.procedures.map((p) => p.code));

/** The draft as stored. It holds no Google name: ProviderFieldsValue only keeps FindYourDent's own. */
export function serializeDraft(state: TestimonyFormState): string {
  return JSON.stringify({ v: 1, state });
}

const isString = (value: unknown): value is string => typeof value === "string";

/**
 * A stored draft back into form state, keeping only fields of the expected shape,
 * so an old or tampered draft never breaks the form. null when there is nothing usable.
 */
export function parseDraft(raw: string | null): TestimonyFormState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as { v?: unknown }).v !== 1) return null;
  const draft = (parsed as { state?: unknown }).state;
  if (typeof draft !== "object" || draft === null) return null;
  const d = draft as Record<string, unknown>;

  const ratings = { ...EMPTY_FORM_STATE.ratings };
  const storedRatings = (typeof d.ratings === "object" && d.ratings) || {};
  for (const aspect of ASPECTS) {
    const value = (storedRatings as Record<string, unknown>)[aspect];
    if (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5) ratings[aspect] = value as number;
  }

  const p = (typeof d.provider === "object" && d.provider ? d.provider : {}) as Record<string, unknown>;
  const region = (typeof p.region === "object" && p.region ? p.region : {}) as Record<string, unknown>;
  const listed = p.listed as { name?: unknown; region?: { provinceCode?: unknown; regencyCode?: unknown } } | null;
  const provider: ProviderFieldsValue = {
    placeId: isString(p.placeId) && p.placeId ? p.placeId : null,
    listed:
      listed && isString(listed.name) && isString(listed.region?.provinceCode) && isString(listed.region?.regencyCode)
        ? (listed as ProviderFieldsValue["listed"])
        : null,
    providerName: isString(p.providerName) ? p.providerName : "",
    region: {
      provinceCode: isString(region.provinceCode) ? region.provinceCode : "",
      regencyCode: isString(region.regencyCode) ? region.regencyCode : "",
      ...(isString(region.districtCode) && region.districtCode ? { districtCode: region.districtCode } : {}),
    },
  };

  return {
    provider,
    ratings,
    text: isString(d.text) ? d.text.slice(0, TESTIMONY_LIMITS.textMaxChars) : "",
    procedureCode: isString(d.procedureCode) && PROCEDURE_CODES.has(d.procedureCode) ? d.procedureCode : "",
    price: isString(d.price) ? d.price.replace(/\D/g, "").slice(0, 10) : "",
    visitYear: isString(d.visitYear) && /^\d{4}$/.test(d.visitYear) ? d.visitYear : "",
    visitMonth: isString(d.visitMonth) && /^(0[1-9]|1[0-2])$/.test(d.visitMonth) ? d.visitMonth : "",
    displayName: isString(d.displayName) ? d.displayName.slice(0, TESTIMONY_LIMITS.displayNameMaxChars) : "",
    consentHonest: d.consentHonest === true,
    consentNoOthers: d.consentNoOthers === true,
  };
}

/** Whether the Patient has typed or picked anything worth keeping. */
export function hasContent(state: TestimonyFormState): boolean {
  return JSON.stringify(state) !== JSON.stringify(EMPTY_FORM_STATE);
}

/** Visit years offered: this year and the four before, newest first. */
export function visitYears(now: Date): string[] {
  const year = now.getFullYear();
  return Array.from({ length: 5 }, (_, i) => String(year - i));
}

/** Whether a month of a year is still ahead (it cannot be a visit yet). */
export function isFutureMonth(year: string, month: string, now: Date): boolean {
  const y = Number(year);
  const m = Number(month);
  return y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);
}

/** "1500000" as "1.500.000" (Indonesian separators in both languages, like formatRupiah). */
export function formatPriceInput(digits: string): string {
  return digits ? new Intl.NumberFormat("id-ID").format(Number(digits)) : "";
}

/** A form error: the message key under `testimonyForm` and its values. */
export interface FormError {
  key:
    | `errors.${keyof (typeof id)["testimonyForm"]["errors"]}`
    | `fileErrors.${keyof (typeof id)["testimonyForm"]["fileErrors"]}`;
  values?: Record<string, number>;
}

/** The check of whether the picked place is Listed (GET /api/providers/:placeId/listing). */
export type ListingCheck = "checking" | "checked" | "failed";

/**
 * The form's own checks before anything is sent, keyed like the server's fieldErrors
 * ("ratings.service", "visitMonth", "region.regencyCode", ...). The server checks again.
 */
export function validateForm(
  state: TestimonyFormState,
  options: {
    mode: "create" | "edit";
    now: Date;
    /** Where the picked place's listing check stands: until "checked", `listed` is not known yet. */
    listing?: ListingCheck;
  },
): Record<string, FormError> {
  const errors: Record<string, FormError> = {};
  if (options.mode === "create") {
    const { provider } = state;
    const listing = options.listing ?? "checked";
    if (!provider.placeId) errors.placeId = { key: "errors.provider" };
    // The name and Region are not shown before the check answers, so the place is what gets marked.
    else if (listing === "checking") errors.placeId = { key: "errors.listingChecking" };
    else if (listing === "failed") errors.placeId = { key: "errors.listingFailed" };
    else if (!provider.listed) {
      if (!provider.providerName.trim()) errors.providerName = { key: "errors.providerName" };
      if (!provider.region.provinceCode) errors["region.provinceCode"] = { key: "errors.region" };
      if (!provider.region.regencyCode) errors["region.regencyCode"] = { key: "errors.region" };
    }
  }
  for (const aspect of ASPECTS) {
    if (state.ratings[aspect] === null) errors[`ratings.${aspect}`] = { key: "errors.rating" };
  }
  if (!state.text.trim()) errors.text = { key: "errors.text" };
  else if (state.text.length > TESTIMONY_LIMITS.textMaxChars) {
    errors.text = { key: "errors.textTooLong", values: { max: TESTIMONY_LIMITS.textMaxChars } };
  }
  if (!state.visitYear || !state.visitMonth) errors.visitMonth = { key: "errors.visitMonth" };
  else if (isFutureMonth(state.visitYear, state.visitMonth, options.now)) {
    errors.visitMonth = { key: "errors.visitFuture" };
  }
  if (state.price) {
    const price = Number(state.price);
    if (!Number.isSafeInteger(price) || price <= 0 || price > TESTIMONY_LIMITS.priceMaxRupiah) {
      errors.pricePaidRupiah = { key: "errors.price" };
    }
  }
  if (!state.displayName.trim()) errors.displayName = { key: "errors.displayName" };
  else if (state.displayName.trim().length > TESTIMONY_LIMITS.displayNameMaxChars) {
    errors.displayName = { key: "errors.displayNameTooLong", values: { max: TESTIMONY_LIMITS.displayNameMaxChars } };
  }
  if (!state.consentHonest || !state.consentNoOthers) errors.consent = { key: "errors.consent" };
  return errors;
}

/** The checks a picked file gets in the browser before the server sniffs it again. */
export function checkPickedFile(file: File, kind: "photo" | "proof"): FormError | null {
  const types: readonly string[] = kind === "photo" ? PHOTO_MIME_TYPES : PROOF_MIME_TYPES;
  const maxBytes = kind === "photo" ? TESTIMONY_LIMITS.photoMaxBytes : TESTIMONY_LIMITS.proofMaxBytes;
  const mb = Math.round(maxBytes / (1024 * 1024));
  if (!types.includes(file.type)) return { key: kind === "photo" ? "fileErrors.photoType" : "fileErrors.proofType" };
  if (file.size > maxBytes)
    return { key: kind === "photo" ? "fileErrors.photoSize" : "fileErrors.proofSize", values: { mb } };
  return null;
}

/** The JSON part of the submit body. Call only once validateForm finds nothing. */
export function toSubmission(
  state: TestimonyFormState,
  options: { placeId: string; keepPhotoPaths?: string[] },
): TestimonySubmission {
  const ratings = state.ratings as AspectRatings;
  const { provider } = state;
  const notListed = !provider.listed;
  return {
    placeId: options.placeId,
    ...(notListed && provider.providerName.trim() ? { providerName: provider.providerName.trim() } : {}),
    ...(notListed && provider.region.provinceCode
      ? {
          region: {
            provinceCode: provider.region.provinceCode,
            regencyCode: provider.region.regencyCode,
            ...(provider.region.districtCode ? { districtCode: provider.region.districtCode } : {}),
          },
        }
      : {}),
    ratings: { service: ratings.service, hygiene: ratings.hygiene, materialsEquipment: ratings.materialsEquipment },
    text: state.text.trim(),
    visitMonth: `${state.visitYear}-${state.visitMonth}`,
    ...(state.procedureCode ? { procedureCode: state.procedureCode } : {}),
    ...(state.price ? { pricePaidRupiah: Number(state.price) } : {}),
    displayName: state.displayName.trim(),
    consent: { honestExperience: state.consentHonest, noOthersPersonalData: state.consentNoOthers },
    ...(options.keepPhotoPaths ? { keepPhotoPaths: options.keepPhotoPaths } : {}),
  };
}

/** Form state from a stored Testimony (edit) or a place picked on a Provider page (create). */
export function stateFromInitial(initial: Partial<TestimonySubmission> | undefined): TestimonyFormState {
  if (!initial) return EMPTY_FORM_STATE;
  const [visitYear = "", visitMonth = ""] = (initial.visitMonth ?? "").split("-");
  return {
    ...EMPTY_FORM_STATE,
    provider: { ...EMPTY_PROVIDER_FIELDS, placeId: initial.placeId ?? null },
    ratings: {
      service: initial.ratings?.service ?? null,
      hygiene: initial.ratings?.hygiene ?? null,
      materialsEquipment: initial.ratings?.materialsEquipment ?? null,
    },
    text: initial.text ?? "",
    procedureCode: initial.procedureCode ?? "",
    price: initial.pricePaidRupiah ? String(initial.pricePaidRupiah) : "",
    visitYear,
    visitMonth,
    displayName: initial.displayName ?? "",
    consentHonest: initial.consent?.honestExperience ?? false,
    consentNoOthers: initial.consent?.noOthersPersonalData ?? false,
  };
}
