import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { fieldClassName, ListingFiltersForm } from "~/components/listing-filters-form";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { loadDirectory } from "~/server/directory.server";
import type { Route } from "./+types/direktori";

/** Server-rendered from FindYourDent's own data; never calls Google Places. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const filters = parseListingFilters(params);
  const q = parseDirectoryQuery(params.get(DIRECTORY_PARAMS.query));
  const sort = parseDirectorySort(params.get(DIRECTORY_PARAMS.sort));
  const rows = context.firestore ? await loadDirectory(context.firestore, { filters, q, sort }) : [];
  return { filters, q, sort, rows, url: `${url.origin}${url.pathname}${url.search}` };
}

/** The most specific named area of the filters (kecamatan names are not loaded in the browser yet). */
function areaName(filters: ListingFilters | undefined): string | null {
  if (filters?.regencyCode) return regencyName(filters.regencyCode);
  if (filters?.provinceCode) return provinceName(filters.provinceCode);
  return null;
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const area = areaName(loaderData?.filters);
  const title = area ? t("directory.metaTitleArea", { area }) : t("directory.metaTitle");
  const description = area ? t("directory.metaDescriptionArea", { area }) : t("directory.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    ...(loaderData?.url ? openGraphMeta({ title, description, url: loaderData.url }) : []),
  ];
}

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
  const { filters, q, sort, rows } = loaderData;
  const { t, i18n } = useTranslation();
  const language: Language = isLanguage(i18n.language) ? i18n.language : "id";
  const location = useVisitorLocation(sort === "jarak");
  const area = areaName(filters);
  const shown = useMemo(
    () =>
      location.status === "ready" ? sortByDistance(rows, location.origin) : rows.map((row) => ({ row, km: null })),
    [rows, location],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
          {area ? t("directory.titleArea", { area }) : t("directory.title")}
        </h1>
        <p className="text-muted-foreground">{t("directory.intro")}</p>
      </div>

      <ListingFiltersForm filters={filters} action="/direktori">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="directory-query" className="text-sm font-medium">
              {t("directory.searchLabel")}
            </label>
            <input
              id="directory-query"
              type="search"
              name={DIRECTORY_PARAMS.query}
              defaultValue={q}
              maxLength={100}
              placeholder={t("directory.searchPlaceholder")}
              className={fieldClassName}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="directory-sort" className="text-sm font-medium">
              {t("directory.sortLabel")}
            </label>
            <select
              id="directory-sort"
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
            <p id="directory-sort-hint" className="text-xs text-muted-foreground">
              {t("directory.sortHint")}
            </p>
          </div>
        </div>
      </ListingFiltersForm>

      <section aria-labelledby="directory-results" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="directory-results" className="text-lg font-semibold">
            {t("directory.resultsHeading")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("directory.resultCount", { count: rows.length })}</p>
        </div>

        {sort === "jarak" && location.status !== "idle" && (
          <p
            role="status"
            className={
              location.status === "denied" || location.status === "unsupported"
                ? "rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2 text-sm"
                : "text-sm text-muted-foreground"
            }
          >
            {location.status === "locating" && t("directory.locating")}
            {location.status === "ready" && t("directory.locationReady")}
            {location.status === "denied" && t("directory.locationDenied")}
            {location.status === "unsupported" && t("directory.locationUnsupported")}
          </p>
        )}

        {rows.length === 0 ? (
          <div
            className="flex flex-col items-start gap-3 rounded-xl border bg-card px-5 py-6"
            data-testid="directory-empty"
          >
            <h3 className="font-semibold">{t("directory.emptyTitle")}</h3>
            <p className="text-muted-foreground">{t("directory.emptyBody")}</p>
            <Button asChild size="lg">
              <Link to="/ceritakan">{t("directory.emptyCta")}</Link>
            </Button>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
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
          <p className="text-sm text-muted-foreground">{t("directory.resultCapped", { count: DIRECTORY_ROW_LIMIT })}</p>
        )}
      </section>
    </div>
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
      className="flex flex-col gap-2 rounded-xl border bg-card px-5 py-4 text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold leading-tight">
          <Link to={providerPath(row.placeId)} className="underline-offset-4 hover:underline focus-visible:underline">
            {row.name}
          </Link>
        </h3>
        {row.claimed && <Badge variant="secondary">{t("directory.claimed")}</Badge>}
      </div>

      <p className="text-sm text-muted-foreground">
        {regionLabel(row.region)}
        {" · "}
        {t(`filters.providerTypes.${row.providerType}`)}
        {row.providerTypeSource === "inferred" && ` (${t("directory.inferred")})`}
        {distance !== undefined &&
          ` · ${distance === null ? t("directory.noLocation") : t("directory.distance", { km: distance })}`}
      </p>

      {row.averages ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {ASPECTS.map((aspect) => (
            <div key={aspect} className="flex gap-1">
              <dt className="text-muted-foreground">{t(`directory.aspects.${aspect}`)}</dt>
              <dd className="font-medium">{formatScore(row.averages?.[aspect] ?? 0, language)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t("directory.noRatings")}</p>
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>{t("directory.testimonies", { count: row.testimonyCount })}</span>
        <span>{t("directory.verifiedVisits", { count: row.verifiedVisitCount })}</span>
        {row.score !== null && (
          <span className="text-muted-foreground">
            {t("directory.score", { score: formatScore(row.score, language) })}
          </span>
        )}
      </p>
    </li>
  );
}
