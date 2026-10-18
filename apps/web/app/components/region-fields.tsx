// Region fields (spec 08): Provinsi, then Kota/Kabupaten, then an optional Kecamatan,
// from the Kemendagri list, chosen by name; codes stay underneath. Shared by the listing
// filters, the Testimony form's provider fields, its "Sarankan koreksi", and the Claim
// form. Each level is disabled until the level above is chosen.
import type { RegionRef } from "@findyourdent/contracts/firestore";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldError, fieldClassName } from "~/components/ui/field";
import { fetchDistricts } from "~/lib/fetch-districts";
import { type DistrictOption, type InitialDistricts, PROVINCES, regenciesOf } from "~/lib/regions";

/** `districtCode` is absent, never "", when no kecamatan is chosen. */
export type RegionFieldsValue = Pick<RegionRef, "provinceCode" | "regencyCode" | "districtCode">;

export interface RegionFieldsProps {
  value: RegionFieldsValue;
  onChange(value: RegionFieldsValue): void;
  /**
   * "filter": each level is optional and its empty choice reads "all".
   * "pick": the empty choice reads "choose", and `required` applies (never to the Kecamatan).
   */
  mode: "filter" | "pick";
  required?: boolean;
  disabled?: boolean;
  /** Offers the optional Kecamatan level. */
  withDistrict?: boolean;
  initialDistricts?: InitialDistricts;
  /** Form field names, for a plain form that submits the codes (the listing filters' GET form). */
  names?: { province: string; regency: string; district?: string };
  errors?: { province?: string; regency?: string; district?: string };
  /** One level per row at every width, for a narrow column such as the Directory's filter sidebar. */
  stacked?: boolean;
}

/** The kecamatan of `regencyCode`, or null while they load (and for no kota). */
function useDistricts(regencyCode: string, enabled: boolean, initial?: InitialDistricts): DistrictOption[] | null {
  const fromLoader = initial && initial.regencyCode === regencyCode ? initial.districts : null;
  const [loaded, setLoaded] = useState<InitialDistricts | null>(null);
  useEffect(() => {
    if (!enabled || !regencyCode || fromLoader) return;
    let current = true;
    fetchDistricts(regencyCode).then(
      (districts) => current && setLoaded({ regencyCode, districts }),
      // The Kecamatan is optional: when its list cannot load, the select offers only the empty choice.
      () => current && setLoaded({ regencyCode, districts: [] }),
    );
    return () => {
      current = false;
    };
  }, [enabled, regencyCode, fromLoader]);
  if (!regencyCode) return null;
  return fromLoader ?? (loaded?.regencyCode === regencyCode ? loaded.districts : null);
}

export function RegionFields({
  value,
  onChange,
  mode,
  required,
  disabled,
  withDistrict,
  initialDistricts,
  names,
  errors = {},
  stacked,
}: RegionFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const regencies = value.provinceCode ? regenciesOf(value.provinceCode) : [];
  const districts = useDistricts(value.regencyCode, Boolean(withDistrict), initialDistricts);
  const filter = mode === "filter";
  const columns = stacked ? "grid gap-4" : withDistrict ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2";

  return (
    <div className={columns}>
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
          // A new province drops the kota and kecamatan, which belonged to the old one.
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
      {withDistrict && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-district`} className="text-sm font-medium">
            {t("regionFields.district")}
          </label>
          <select
            id={`${id}-district`}
            name={names?.district}
            disabled={disabled || !value.regencyCode || districts === null}
            value={value.districtCode ?? ""}
            onChange={(event) => {
              const districtCode = event.currentTarget.value;
              onChange({
                provinceCode: value.provinceCode,
                regencyCode: value.regencyCode,
                ...(districtCode ? { districtCode } : {}),
              });
            }}
            aria-invalid={errors.district ? true : undefined}
            aria-describedby={errors.district ? `${id}-district-error` : undefined}
            className={fieldClassName}
          >
            <option value="">
              {!value.regencyCode
                ? t("regionFields.chooseRegencyFirst")
                : filter
                  ? t("regionFields.allDistricts")
                  : t("regionFields.chooseDistrict")}
            </option>
            {(districts ?? []).map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          {errors.district ? <FieldError id={`${id}-district-error`}>{errors.district}</FieldError> : null}
        </div>
      )}
    </div>
  );
}
