// Filters shared by the landing feed and the Listed Provider directory (spec 04).
// A plain GET form: filter state lives in the URL, and it works before hydration.
import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { ProviderType } from "@findyourdent/contracts/firestore";
import type * as React from "react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { RegionFields, type RegionFieldsValue } from "~/components/region-fields";
import { Button } from "~/components/ui/button";
import { fieldClassName } from "~/components/ui/field";
import { isLanguage } from "~/i18n/config";
import { FILTER_PARAMS, hasActiveFilters, type ListingFilters } from "~/lib/listing-filters";
import { cn } from "~/lib/utils";

const PROVIDER_TYPES: readonly ProviderType[] = ["klinik", "privateDentist", "hospital"];

export function ListingFiltersForm(props: {
  filters: ListingFilters;
  action: string;
  /** Lets inputs elsewhere on the page join this form through their `form` attribute. */
  id?: string;
  /**
   * "grid": two columns from the small breakpoint, labelled for screen readers only (the feed).
   * "sidebar": one column in a card with a visible "Saring" heading (the Directory).
   */
  layout?: "grid" | "sidebar";
  children?: React.ReactNode;
}) {
  const { filters, action, id, layout = "grid", children } = props;
  const sidebar = layout === "sidebar";
  const headingId = useId();
  const { t, i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : "id";
  // The kota list follows the chosen province. Without JavaScript it lists the
  // province from the URL, so choosing a province and applying shows its kota.
  const fromUrl: RegionFieldsValue = {
    provinceCode: filters.provinceCode ?? "",
    regencyCode: filters.regencyCode ?? "",
  };
  const [region, setRegion] = useState(fromUrl);
  // A new URL (applied filters, Reset, back) replaces what was chosen but not applied.
  const [lastUrl, setLastUrl] = useState(fromUrl);
  if (lastUrl.provinceCode !== fromUrl.provinceCode || lastUrl.regencyCode !== fromUrl.regencyCode) {
    setLastUrl(fromUrl);
    setRegion(fromUrl);
  }
  // No kecamatan select yet: a kecamatan from the URL is kept while its kota stays chosen.
  const keepsDistrict = Boolean(filters.districtCode) && region.regencyCode === filters.regencyCode;

  return (
    <Form
      id={id}
      method="get"
      action={action}
      className={cn("flex flex-col gap-4", sidebar && "rounded-lg border bg-card p-5 text-card-foreground")}
      aria-label={sidebar ? undefined : t("filters.title")}
      aria-labelledby={sidebar ? headingId : undefined}
    >
      {sidebar && (
        <h2 id={headingId} className="text-base leading-[22px] font-[650]">
          {t("filters.title")}
        </h2>
      )}
      <div className={sidebar ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
        <div className={sidebar ? undefined : "sm:col-span-2"}>
          <RegionFields
            stacked={sidebar}
            mode="filter"
            value={region}
            onChange={setRegion}
            names={{ province: FILTER_PARAMS.provinceCode, regency: FILTER_PARAMS.regencyCode }}
          />
          {keepsDistrict && <input type="hidden" name={FILTER_PARAMS.districtCode} value={filters.districtCode} />}
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

        <div className={cn("flex min-h-touch items-center gap-2", !sidebar && "self-end")}>
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
        <Button type="submit" size={sidebar ? "sm" : undefined}>
          {t("filters.apply")}
        </Button>
        {hasActiveFilters(filters) && (
          <Button asChild variant="ghost" size={sidebar ? "sm" : undefined}>
            <Link to={action}>{t("filters.reset")}</Link>
          </Button>
        )}
      </div>
    </Form>
  );
}
