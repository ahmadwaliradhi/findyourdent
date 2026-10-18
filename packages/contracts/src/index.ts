// @findyourdent/contracts: shared JSON Schema contracts between the web app and
// the agent service. Types are generated (src/generated), validators are Ajv
// (draft 2020-12 + formats), and the shared data files are typed here.
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import procedureListJson from "../data/procedures.json" with { type: "json" };
import regionListJson from "../data/regions.json" with { type: "json" };
import districtsSchema from "../schemas/districts.schema.json" with { type: "json" };
import guidanceRequestSchema from "../schemas/guidance-request.schema.json" with { type: "json" };
import guidanceResponseSchema from "../schemas/guidance-response.schema.json" with { type: "json" };
import moderationDecisionSchema from "../schemas/moderation-decision.schema.json" with { type: "json" };
import moderationRequestSchema from "../schemas/moderation-request.schema.json" with { type: "json" };
import priceListExtractionRequestSchema from "../schemas/price-list-extraction-request.schema.json" with {
  type: "json",
};
import priceListExtractionResponseSchema from "../schemas/price-list-extraction-response.schema.json" with {
  type: "json",
};
import proceduresSchema from "../schemas/procedures.schema.json" with { type: "json" };
import regionsSchema from "../schemas/regions.schema.json" with { type: "json" };
import shortlistReasonsRequestSchema from "../schemas/shortlist-reasons-request.schema.json" with { type: "json" };
import shortlistReasonsResponseSchema from "../schemas/shortlist-reasons-response.schema.json" with { type: "json" };
import type {
  DistrictList,
  GuidanceRequest,
  GuidanceResponse,
  ModerationDecision,
  ModerationRequest,
  PriceListExtractionRequest,
  PriceListExtractionResponse,
  Procedure,
  ProcedureList,
  RegionList,
  ShortlistReasonsRequest,
  ShortlistReasonsResponse,
} from "./generated/index.js";

export type * from "./generated/index.js";
export type { ValidateFunction };

/** Every schema in schemas/, keyed by file name without `.schema.json`. */
export const SCHEMAS = {
  districts: districtsSchema,
  "guidance-request": guidanceRequestSchema,
  "guidance-response": guidanceResponseSchema,
  "moderation-decision": moderationDecisionSchema,
  "moderation-request": moderationRequestSchema,
  "price-list-extraction-request": priceListExtractionRequestSchema,
  "price-list-extraction-response": priceListExtractionResponseSchema,
  procedures: proceduresSchema,
  regions: regionsSchema,
  "shortlist-reasons-request": shortlistReasonsRequestSchema,
  "shortlist-reasons-response": shortlistReasonsResponseSchema,
} as const;

// ajv-formats is CommonJS; depending on interop the plugin is the module or its default.
const addFormats = ((addFormatsModule as { default?: unknown }).default ?? addFormatsModule) as typeof addFormatsModule;

// Strict, except strictRequired: "complaintText or audio" style branches list
// `required` keys that are defined in the parent's `properties`.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);

const compile = <T>(schema: object): ValidateFunction<T> => ajv.compile<T>(schema);

/** Ajv validators: type guards that expose `.errors` after a failed call. */
export const validateGuidanceRequest = compile<GuidanceRequest>(guidanceRequestSchema);
export const validateGuidanceResponse = compile<GuidanceResponse>(guidanceResponseSchema);
export const validateShortlistReasonsRequest = compile<ShortlistReasonsRequest>(shortlistReasonsRequestSchema);
export const validateShortlistReasonsResponse = compile<ShortlistReasonsResponse>(shortlistReasonsResponseSchema);
export const validateModerationRequest = compile<ModerationRequest>(moderationRequestSchema);
export const validateModerationDecision = compile<ModerationDecision>(moderationDecisionSchema);
export const validatePriceListExtractionRequest = compile<PriceListExtractionRequest>(priceListExtractionRequestSchema);
export const validatePriceListExtractionResponse = compile<PriceListExtractionResponse>(
  priceListExtractionResponseSchema,
);
export const validateProcedureList = compile<ProcedureList>(proceduresSchema);
export const validateRegionList = compile<RegionList>(regionsSchema);
export const validateDistrictList = compile<DistrictList>(districtsSchema);

/** One-line summary of Ajv errors for logs and error responses (never includes the data). */
export function formatValidationErrors(errors: ValidateFunction["errors"]): string {
  if (!errors || errors.length === 0) return "";
  return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`).join("; ");
}

/** The shared procedure list (data/procedures.json). */
export const PROCEDURE_LIST: ProcedureList = procedureListJson as ProcedureList;
export const PROCEDURES: readonly Procedure[] = PROCEDURE_LIST.procedures;
export const PROCEDURE_CODES: ReadonlySet<string> = new Set(PROCEDURES.map((p) => p.code));
export function isProcedureCode(code: string): boolean {
  return PROCEDURE_CODES.has(code);
}

/**
 * Kemendagri region codes (data/regions.json): all `provinces` and
 * `regencies` (kabupaten/kota) from Kepmendagri 300.2.2-2138/2025 as amended
 * by 300.2.2-2430/2025. Kecamatan are in data/districts.json, imported directly
 * (`@findyourdent/contracts/data/districts.json`) where needed: at about 700 KB it
 * stays out of this index.
 */
export const REGIONS: RegionList = regionListJson as RegionList;
