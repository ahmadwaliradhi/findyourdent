// STUB (T11 seam): owned by the "picker, name and Region" sub-agent.
import type { ProviderFieldsValue } from "~/lib/testimony";

export interface ProviderFieldsProps {
  value: ProviderFieldsValue;
  onChange(value: ProviderFieldsValue): void;
  /** Field name to message, from the server's fieldErrors (placeId, providerName, region.provinceCode, region.regencyCode). */
  errors?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Provider picker (Places Autocomplete through /api/places/autocomplete), then either
 * the typed-name field and Region selects (not Listed) or the stored name and Region
 * read-only with "Sarankan koreksi" (Listed).
 */
export function ProviderFields(_props: ProviderFieldsProps) {
  return null;
}
