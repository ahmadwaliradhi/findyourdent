import { BadgeCheck, CircleHelp, Navigation, OctagonAlert, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ListingFiltersForm } from "~/components/listing-filters-form";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { fieldClassName } from "~/components/ui/field";
import { getI18n, isLanguage, type Language } from "~/i18n/config";
import { ASPECTS } from "~/lib/aspects";
import {
  DIRECTORY_PARAMS,
  DIRECTORY_ROW_LIMIT,
  DIRECTORY_SORTS,
  type DirectoryRow,
  type DirectorySort,
  parseDirectoryQuery,
  parseDirectorySort,
} from "~/lib/directory";
import { formatKm, formatScore } from "~/lib/format";
import { haversineKm, type LatLng } from "~/lib/geo";
import { type ListingFilters, parseListingFilters } from "~/lib/listing-filters";
import { providerPath } from "~/lib/paths";
import { provinceName, regencyName, regionLabel } from "~/lib/regions";
import { openGraphMeta } from "~/lib/seo";
import { cn } from "~/lib/utils";
import { loadDirectory } from "~/server/directory.server";
import { listingDistricts } from "~/server/districts.server";
import type { Route } from "./+types/direktori";

/** Server-rendered from FindYourDent's own data; never calls Google Places. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const filters = parseListingFilters(params);
  const q = parseDirectoryQuery(params.get(DIRECTORY_PARAMS.query));
  const sort = parseDirectorySort(params.get(DIRECTORY_PARAMS.sort));
  const rows = context.firestore ? await loadDirectory(context.firestore, { filters, q, sort }) : [];
  return {
    filters,
    kecamatan: listingDistricts(filters),
    q,
    sort,
    rows,
    url: `${url.origin}${url.pathname}${url.search}`,
  };
}

/** The most specific named Region levels of the filters: "Gambir, Kota Administrasi Jakarta Pusat". */
function areaName(filters: ListingFilters | undefined, district: string | null | undefined): string | null {
  if (filters?.regencyCode) {
    return district ? `${district}, ${regencyName(filters.regencyCode)}` : regencyName(filters.regencyCode);
  }
  if (filters?.provinceCode) return provinceName(filters.provinceCode);
  return null;
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const area = areaName(loaderData?.filters, loaderData?.kecamatan.chosenName);
  const title = area ? t("directory.metaTitleArea", { area }) : t("directory.metaTitle");
  const description = area ? t("directory.metaDescriptionArea", { area }) : t("directory.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    ...(loaderData?.url ? openGraphMeta({ title, description, url: loaderData.url }) : []),
  ];
}

/** Ties the search and sort inputs in the results column to the filters form in the sidebar. */
const FORM_ID = "directory-filters";

type LocationState = { status: "idle" | "locating" | "denied" | "unsupported" } | { status: "ready"; origin: LatLng };

/** Asks the browser for the visitor's position when the distance sort is chosen. It stays in the browser. */
function useVisitorLocation(enabled: boolean): LocationState {
  const [state, setState] = useState<LocationState>({ status: "idle" });
  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    if (!("geolocation" in navigator)) {
      setState({ status: "unsupported" });
      return;
    }
    let cancelled = false;
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!cancelled) setState({ status: "ready", origin: { lat: coords.latitude, lng: coords.longitude } });
      },
      () => {
        if (!cancelled) setState({ status: "denied" });
      },
      { maximumAge: 10 * 60_000, timeout: 15_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}

/** Rows with coordinates nearest first; rows without coordinates keep the server order, last. */
function sortByDistance(rows: DirectoryRow[], origin: LatLng): { row: DirectoryRow; km: number | null }[] {
  const withKm = rows.map((row) => ({ row, km: row.location ? haversineKm(origin, row.location) : null }));
  const located = withKm.filter((r) => r.km !== null).sort((a, b) => (a.km as number) - (b.km as number));
  return [...located, ...withKm.filter((r) => r.km === null)];
}

export default function Directory({ loaderData }: Route.ComponentProps) {
  const { filters, kecamatan, q, sort, rows } = loaderData;
  const { t, i18n } = useTranslation();
  const language: Language = isLanguage(i18n.language) ? i18n.language : "id";
  const location = useVisitorLocation(sort === "jarak");
  const area = areaName(filters, kecamatan.chosenName);
  const shown = useMemo(
    () =>
      location.status === "ready" ? sortByDistance(rows, location.origin) : rows.map((row) => ({ row, km: null })),
    [rows, location],
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-4xl desktop:leading-[42px]">
          {area ? t("directory.titleArea", { area }) : t("directory.title")}
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground">{t("directory.intro")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[280px_minmax(0,1fr)] desktop:items-start desktop:gap-10">
        <aside className="desktop:sticky desktop:top-6">
          <ListingFiltersForm
            id={FORM_ID}
            filters={filters}
            districts={kecamatan.options}
            action="/direktori"
            layout="sidebar"
          />
        </aside>

        <section aria-labelledby="directory-results" className="flex flex-col gap-4">
          {/* Part of the filters form through `form`, so one Apply (or Enter here) sends everything. */}
          <div className="grid gap-3 desktop:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="directory-query" className="text-sm font-semibold">
                {t("directory.searchLabel")}
              </label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  id="directory-query"
                  type="search"
                  form={FORM_ID}
                  name={DIRECTORY_PARAMS.query}
                  defaultValue={q}
                  maxLength={100}
                  placeholder={t("directory.searchPlaceholder")}
                  className={cn(fieldClassName, "pl-11")}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="directory-sort" className="text-sm font-semibold">
                {t("directory.sortLabel")}
              </label>
              <select
                id="directory-sort"
                form={FORM_ID}
                name={DIRECTORY_PARAMS.sort}
                defaultValue={sort}
                aria-describedby="directory-sort-hint"
                className={fieldClassName}
              >
                {DIRECTORY_SORTS.map((value: DirectorySort) => (
                  <option key={value} value={value}>
                    {t(`directory.sort.${value}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="directory-results" className="text-base leading-[22px] font-[650]">
              {t("directory.resultsHeading")}{" "}
              <span className="font-medium text-muted-foreground">
                · {t("directory.resultCount", { count: rows.length })}
              </span>
            </h2>
            {sort === "jarak" && location.status !== "idle" && <LocationStatus status={location.status} />}
          </div>

          {rows.length === 0 ? (
            <div
              className="flex flex-col items-start gap-3 rounded-lg border bg-card px-5 py-6"
              data-testid="directory-empty"
            >
              <h3 className="text-lg leading-6 font-[650]">{t("directory.emptyTitle")}</h3>
              <p className="text-muted-foreground">{t("directory.emptyBody")}</p>
              <Button asChild size="lg">
                <Link to="/ceritakan">{t("directory.emptyCta")}</Link>
              </Button>
            </div>
          ) : (
            <ol className="flex flex-col divide-y rounded-lg border bg-card">
              {shown.map(({ row, km }) => (
                <DirectoryRowItem
                  key={row.placeId}
                  row={row}
                  distance={location.status === "ready" ? (km === null ? null : formatKm(km, language)) : undefined}
                />
              ))}
            </ol>
          )}

          {rows.length >= DIRECTORY_ROW_LIMIT && (
            <p className="text-sm text-muted-foreground">
              {t("directory.resultCapped", { count: DIRECTORY_ROW_LIMIT })}
            </p>
          )}
          <p id="directory-sort-hint" className="text-center text-xs font-medium text-muted-foreground">
            {t("directory.sortHint")}
          </p>
        </section>
      </div>
    </div>
  );
}

const LOCATION_MESSAGE = {
  locating: "directory.locating",
  ready: "directory.locationReady",
  denied: "directory.locationDenied",
  unsupported: "directory.locationUnsupported",
} as const;

/** Where the distance sort stands; a failure says so with an icon and the fallback order. */
function LocationStatus({ status }: { status: keyof typeof LOCATION_MESSAGE }) {
  const { t } = useTranslation();
  const failed = status === "denied" || status === "unsupported";
  const Icon = failed ? OctagonAlert : Navigation;
  return (
    <p
      role="status"
      className={
        failed
          ? "flex w-full items-start gap-2 rounded-md border border-destructive-line bg-destructive-soft px-3 py-2 text-sm"
          : "flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      }
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={failed ? "mt-0.5 size-4 shrink-0 text-destructive" : "size-4 shrink-0"}
      />
      {t(LOCATION_MESSAGE[status])}
    </p>
  );
}

/** distance: formatted km, null when the row has no coordinates, undefined when not sorting by distance. */
function DirectoryRowItem({ row, distance }: { row: DirectoryRow; distance: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  const language: Language = isLanguage(i18n.language) ? i18n.language : "id";
  const headingId = `provider-${row.placeId}`;

  return (
    <li
      data-testid="directory-row"
      data-place-id={row.placeId}
      aria-labelledby={headingId}
      className="grid grid-cols-1 gap-3 px-5 py-4 text-card-foreground desktop:grid-cols-[minmax(0,1fr)_auto] desktop:items-center"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="text-lg leading-6 font-[650]">
            <Link
              to={providerPath(row.placeId)}
              className="-my-2.5 inline-flex min-h-touch items-center underline-offset-4 hover:underline focus-visible:underline"
            >
              {row.name}
            </Link>
          </h3>
          <Badge variant="neutral">{t(`filters.providerTypes.${row.providerType}`)}</Badge>
          {row.providerTypeSource === "inferred" && (
            <Badge variant="outline" icon={CircleHelp}>
              {t("directory.inferred")}
            </Badge>
          )}
          {row.claimed && (
            <Badge variant="brand" icon={BadgeCheck}>
              {t("directory.claimed")}
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{regionLabel(row.region)}</p>

        {row.averages ? (
          <p className="text-sm tabular-nums">
            {row.score !== null && (
              <b className="font-semibold">{t("directory.score", { score: formatScore(row.score, language) })}</b>
            )}
            <span className="text-muted-foreground">
              {ASPECTS.map((aspect, index) => {
                const separator = index > 0 || row.score !== null ? " · " : "";
                return `${separator}${t(`directory.aspects.${aspect}`)} ${formatScore(row.averages?.[aspect] ?? 0, language)}`;
              }).join("")}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("directory.noRatings")}</p>
        )}

        <p className="text-xs font-medium text-muted-foreground">
          {t("directory.testimonies", { count: row.testimonyCount })}
          {row.verifiedVisitCount > 0 && ` · ${t("directory.verifiedVisits", { count: row.verifiedVisitCount })}`}
        </p>
      </div>

      {distance !== undefined && (
        <Badge variant="outline" className="tabular-nums">
          {distance === null ? t("directory.noLocation") : t("directory.distance", { km: distance })}
        </Badge>
      )}
    </li>
  );
}
