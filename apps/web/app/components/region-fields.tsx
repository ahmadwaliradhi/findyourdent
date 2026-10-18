// Region fields (spec 08): Provinsi, then Kota/Kabupaten, from the Kemendagri list,
// chosen by name; codes stay underneath. Shared by the listing filters, the Testimony
// form's provider fields, its "Sarankan koreksi", and the Claim form. Each level is
// disabled until the level above is chosen. Kecamatan joins as a third level later.
import type { RegionRef } from "@findyourdent/contracts/firestore";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { FieldError, fieldClassName } from "~/components/ui/field";
import { PROVINCES, regenciesOf } from "~/lib/regions";

/** The levels these fields offer today; `districtCode` joins with the Kecamatan level. */
export type RegionFieldsValue = Pick<RegionRef, "provinceCode" | "regencyCode">;

export interface RegionFieldsProps {
  value: RegionFieldsValue;
  onChange(value: RegionFieldsValue): void;
  /**
   * "filter": each level is optional and its empty choice reads "all".
   * "pick": the empty choice reads "choose", and `required` applies.
   */
  mode: "filter" | "pick";
  required?: boolean;
  disabled?: boolean;
  /** Form field names, for a plain form that submits the codes (the listing filters' GET form). */
  names?: { province: string; regency: string };
  errors?: { province?: string; regency?: string };
  /** One level per row at every width, for a narrow column such as the Directory's filter sidebar. */
  stacked?: boolean;
}

export function RegionFields({
  value,
  onChange,
  mode,
  required,
  disabled,
  names,
  errors = {},
  stacked,
}: RegionFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const regencies = value.provinceCode ? regenciesOf(value.provinceCode) : [];
  const filter = mode === "filter";

  return (
    <div className={stacked ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-province`} className="text-sm font-medium">
          {t("regionFields.province")}
        </label>
        <select
          id={`${id}-province`}
          name={names?.province}
          required={required}
          disabled={disabled}
          value={value.provinceCode}
          // A new province drops the kota, which belonged to the old one.
          onChange={(event) => onChange({ provinceCode: event.currentTarget.value, regencyCode: "" })}
          aria-invalid={errors.province ? true : undefined}
          aria-describedby={errors.province ? `${id}-province-error` : undefined}
          className={fieldClassName}
        >
          <option value="">{filter ? t("regionFields.allProvinces") : t("regionFields.chooseProvince")}</option>
          {PROVINCES.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        {errors.province ? <FieldError id={`${id}-province-error`}>{errors.province}</FieldError> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-regency`} className="text-sm font-medium">
          {t("regionFields.regency")}
        </label>
        <select
          id={`${id}-regency`}
          name={names?.regency}
          required={required}
          disabled={disabled || !value.provinceCode}
          value={value.regencyCode}
          onChange={(event) => onChange({ provinceCode: value.provinceCode, regencyCode: event.currentTarget.value })}
          aria-invalid={errors.regency ? true : undefined}
          aria-describedby={errors.regency ? `${id}-regency-error` : undefined}
          className={fieldClassName}
        >
          <option value="">
            {!value.provinceCode
              ? t("regionFields.chooseProvinceFirst")
              : filter
                ? t("regionFields.allRegencies")
                : t("regionFields.chooseRegency")}
          </option>
          {regencies.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        {errors.regency ? <FieldError id={`${id}-regency-error`}>{errors.regency}</FieldError> : null}
      </div>
    </div>
  );
}
