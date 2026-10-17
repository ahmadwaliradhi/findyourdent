// Filters shared by the landing feed and the Listed Provider directory (spec 04).
// A plain GET form: filter state lives in the URL, and it works before hydration.
import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { ProviderType } from "@findyourdent/contracts/firestore";
import type * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { isLanguage } from "~/i18n/config";
import { FILTER_PARAMS, hasActiveFilters, type ListingFilters } from "~/lib/listing-filters";
import { PROVINCES, REGENCIES } from "~/lib/regions";

const PROVIDER_TYPES: readonly ProviderType[] = ["klinik", "privateDentist", "hospital"];

/** Native controls styled like the other inputs, so they stay keyboard and screen-reader friendly. */
export const fieldClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function ListingFiltersForm(props: { filters: ListingFilters; action: string; children?: React.ReactNode }) {
  const { filters, action, children } = props;
  const { t, i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : "id";
  // The kota list follows the chosen province. Without JavaScript it lists the
  // province from the URL, so choosing a province and applying shows its kota.
  const [provinceCode, setProvinceCode] = useState(filters.provinceCode ?? "");
  const regencies = provinceCode ? REGENCIES.filter((r) => r.provinceCode === provinceCode) : [];
  const keepsRegency = provinceCode === (filters.provinceCode ?? "");

  return (
    <Form method="get" action={action} className="flex flex-col gap-4" aria-label={t("filters.title")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-province" className="text-sm font-medium">
            {t("filters.province")}
          </label>
          <select
            id="filter-province"
            name={FILTER_PARAMS.provinceCode}
            value={provinceCode}
            onChange={(event) => setProvinceCode(event.currentTarget.value)}
            className={fieldClassName}
          >
            <option value="">{t("filters.allProvinces")}</option>
            {PROVINCES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-regency" className="text-sm font-medium">
            {t("filters.regency")}
          </label>
          <select
            // Remounts when the province changes, so a kota from another province is not kept.
            key={provinceCode}
            id="filter-regency"
            name={FILTER_PARAMS.regencyCode}
            defaultValue={keepsRegency ? (filters.regencyCode ?? "") : ""}
            className={fieldClassName}
          >
            <option value="">{provinceCode ? t("filters.allRegencies") : t("filters.chooseProvinceFirst")}</option>
            {regencies.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-district" className="text-sm font-medium">
            {t("filters.district")}
          </label>
          <input
            id="filter-district"
            name={FILTER_PARAMS.districtCode}
            defaultValue={filters.districtCode ?? ""}
            inputMode="decimal"
            pattern="\d{2}\.\d{2}\.\d{2}"
            placeholder="31.71.01"
            aria-describedby="filter-district-hint"
            className={fieldClassName}
          />
          <p id="filter-district-hint" className="text-xs text-muted-foreground">
            {t("filters.districtHint")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-procedure" className="text-sm font-medium">
            {t("filters.procedure")}
          </label>
          <select
            id="filter-procedure"
            name={FILTER_PARAMS.procedureCode}
            defaultValue={filters.procedureCode ?? ""}
            className={fieldClassName}
          >
            <option value="">{t("filters.allProcedures")}</option>
            {procedureList.procedures.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label[language]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-provider-type" className="text-sm font-medium">
            {t("filters.providerType")}
          </label>
          <select
            id="filter-provider-type"
            name={FILTER_PARAMS.providerType}
            defaultValue={filters.providerType ?? ""}
            className={fieldClassName}
          >
            <option value="">{t("filters.allProviderTypes")}</option>
            {PROVIDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`filters.providerTypes.${type}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 self-end pb-2">
          <input
            id="filter-verified"
            type="checkbox"
            name={FILTER_PARAMS.verifiedOnly}
            value="1"
            defaultChecked={filters.verifiedOnly}
            className="size-4 accent-primary"
          />
          <label htmlFor="filter-verified" className="text-sm font-medium">
            {t("filters.verifiedOnly")}
          </label>
        </div>
      </div>

      {children}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{t("filters.apply")}</Button>
        {hasActiveFilters(filters) && (
          <Button asChild variant="ghost">
            <Link to={action}>{t("filters.reset")}</Link>
          </Button>
        )}
      </div>
    </Form>
  );
}
