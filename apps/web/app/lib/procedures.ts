// Import the data file only (not the package index) so Ajv stays out of the browser bundle.
import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { Language } from "~/i18n/config";

const labels = new Map(procedureList.procedures.map((p) => [p.code, p.label] as const));

export function procedureLabel(code: string, language: Language): string {
  return labels.get(code)?.[language] ?? code;
}
