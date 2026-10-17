import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { GoogleReviews } from "~/components/google-reviews";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { Language } from "~/i18n/config";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { keepAcrossReload, recallAcrossReload, recallEntry, rememberEntry } from "~/lib/entry-memory";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatDistance, formatRupiah, formatScore } from "~/lib/format";
import { providerPath } from "~/lib/paths";
import { procedureLabel } from "~/lib/procedures";
import type { ShortlistProvider, ShortlistResponse } from "~/lib/shortlist";

type Where = { location: { lat: number; lng: number } } | { area: string };

type State =
  | { phase: "closed" }
  | { phase: "asking"; locationDenied?: boolean }
  | { phase: "locating" }
  | { phase: "searching" }
  | { phase: "done"; result: ShortlistResponse }
  | { phase: "error" };

/**
 * "Lihat dokter gigi terdekat" (spec 02): the Patient shares a location or types an
 * area, and the page asks /api/shortlist with an App Check token. Rendered inside the
 * home Guidance form, so it uses no form of its own.
 */
export function ShortlistPanel(
  props: { purpose: "shortlist"; guidanceToken: string } | { purpose: "emergency"; guidanceToken?: undefined },
) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === "en" ? "en" : "id") as Language;
  const firebase = useFirebaseConfig();
  // Back from a Provider page shows the same results again, with no second Text Search.
  // Each Guidance submit is a new history entry, so a panel still mounted from the
  // last one starts over from whatever the new entry remembers (nothing, at first).
  const { key: entryKey } = useLocation();
  const slot = `shortlist:${props.purpose}:${props.guidanceToken ?? ""}`;
  // After a reload only "it was open" is left (results are Google data, never stored), so it opens ready to search.
  const openSlot = `shortlist:${props.purpose}:open`;
  const recalled = (): State =>
    recallEntry<State>(entryKey, slot) ??
    (recallAcrossReload(entryKey, openSlot) ? { phase: "asking" } : { phase: "closed" });
  const [state, setState] = useState<State>(recalled);
  const [stateEntry, setStateEntry] = useState(entryKey);
  if (stateEntry !== entryKey) {
    setStateEntry(entryKey);
    setState(recalled());
  }
  useEffect(() => {
    // Settled states only: a closed panel stays closed on Back, and results replace older ones.
    if (state.phase === "done" || state.phase === "closed") rememberEntry(entryKey, slot, state);
    if (state.phase !== "closed") keepAcrossReload(entryKey, openSlot, "1");
  }, [entryKey, slot, openSlot, state]);
  const [area, setArea] = useState("");
  const areaId = useId();
  const emergency = props.purpose === "emergency";

  const search = async (where: Where) => {
    setState({ phase: "searching" });
    try {
      const token = await getAppCheckToken(firebase).catch(() => "");
      const response = await fetch("/api/shortlist", {
        method: "POST",
        headers: { "content-type": "application/json", [APP_CHECK_HEADER]: token },
        body: JSON.stringify({ purpose: props.purpose, guidanceToken: props.guidanceToken, ...where }),
      });
      if (!response.ok) throw new Error(`shortlist ${response.status}`);
      setState({ phase: "done", result: (await response.json()) as ShortlistResponse });
    } catch {
      setState({ phase: "error" });
    }
  };

  const shareLocation = () => {
    if (!("geolocation" in navigator)) {
      setState({ phase: "asking", locationDenied: true });
      return;
    }
    setState({ phase: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => void search({ location: { lat: position.coords.latitude, lng: position.coords.longitude } }),
      () => setState({ phase: "asking", locationDenied: true }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  };

  const searchArea = () => {
    const typed = area.trim();
    if (typed.length >= 2) void search({ area: typed });
  };
  const onAreaKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter would submit the surrounding Guidance form.
    if (event.key === "Enter") {
      event.preventDefault();
      searchArea();
    }
  };

  if (state.phase === "closed") {
    return (
      <Button
        type="button"
        size="lg"
        variant={emergency ? "outline" : "default"}
        className="h-auto w-full whitespace-normal py-3 sm:w-auto sm:self-start"
        onClick={() => setState({ phase: "asking" })}
      >
        {emergency ? t("shortlist.openEmergency") : t("shortlist.open")}
      </Button>
    );
  }

  const busy = state.phase === "locating" || state.phase === "searching";
  return (
    <section className="flex flex-col gap-3" aria-busy={busy} data-testid="shortlist">
      <h3 className="font-semibold">{emergency ? t("shortlist.emergencyTitle") : t("shortlist.title")}</h3>
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={shareLocation} disabled={busy} className="w-full sm:w-auto sm:self-start">
          {state.phase === "locating" ? t("shortlist.locating") : t("shortlist.useLocation")}
        </Button>
        {state.phase === "asking" && state.locationDenied && (
          <p className="text-sm text-destructive">{t("shortlist.locationDenied")}</p>
        )}
        <label htmlFor={areaId} className="text-sm font-medium">
          {t("shortlist.areaLabel")}
        </label>
        <div className="flex gap-2">
          <input
            id={areaId}
            value={area}
            onChange={(event) => setArea(event.target.value)}
            onKeyDown={onAreaKey}
            maxLength={100}
            placeholder={t("shortlist.areaPlaceholder")}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
          />
          <Button type="button" variant="secondary" onClick={searchArea} disabled={busy || area.trim().length < 2}>
            {state.phase === "searching" ? t("shortlist.searching") : t("shortlist.search")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("shortlist.privacy")}</p>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {state.phase === "error" && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2 text-sm">
            {t("shortlist.error")}
          </p>
        )}
        {state.phase === "done" && <ShortlistProviders result={state.result} language={language} />}
      </div>
    </section>
  );
}

function ShortlistProviders({ result, language }: { result: ShortlistResponse; language: Language }) {
  const { t } = useTranslation();
  return (
    <>
      {result.source === "listedProviders" && <p className="text-sm">{t("shortlist.fallbackNote")}</p>}
      {result.providers.length === 0 && <p className="text-sm">{t("shortlist.empty")}</p>}
      {result.providers.length > 0 && (
        <ol className="flex flex-col gap-3">
          {result.providers.map((provider) => (
            <ProviderCard key={provider.placeId} provider={provider} language={language} />
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">{t("shortlist.rankingNote")}</p>
      {result.mapsSearchUrl && (
        <Button asChild variant="outline" size="sm" className="self-start">
          <a href={result.mapsSearchUrl} target="_blank" rel="noreferrer">
            {t("shortlist.mapsSearch")}
          </a>
        </Button>
      )}
    </>
  );
}

function ProviderCard({ provider, language }: { provider: ShortlistProvider; language: Language }) {
  const { t } = useTranslation();
  const { testimonies } = provider;
  return (
    <li className="flex flex-col gap-2 rounded-md border px-3 py-3" data-place-id={provider.placeId}>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          {provider.rank}. {provider.name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{t(`shortlist.type.${provider.providerType}`)}</Badge>
          {provider.providerTypeSource === "inferred" && <Badge variant="outline">{t("shortlist.estimated")}</Badge>}
          {provider.claimed && <Badge>{t("shortlist.claimed")}</Badge>}
          {provider.distanceMeters !== null && (
            <span className="text-sm text-muted-foreground">{formatDistance(provider.distanceMeters, language)}</span>
          )}
        </div>
        {provider.formattedAddress && <p className="text-sm text-muted-foreground">{provider.formattedAddress}</p>}
      </div>
      <p className="text-sm">{provider.reason}</p>
      <div className="text-sm">
        {testimonies.count === 0 ? (
          <p className="text-muted-foreground">{t("shortlist.testimoniesNone")}</p>
        ) : (
          <>
            <p>
              {t("shortlist.testimoniesCount", { count: testimonies.count, verified: testimonies.verifiedVisitCount })}
            </p>
            {testimonies.averages && (
              <p className="text-muted-foreground">
                {t("shortlist.aspects", {
                  service: formatScore(testimonies.averages.service, language),
                  hygiene: formatScore(testimonies.averages.hygiene, language),
                  materials: formatScore(testimonies.averages.materialsEquipment, language),
                })}
              </p>
            )}
          </>
        )}
      </div>
      {provider.priceSignals.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {provider.priceSignals.map((signal) => (
            <li key={`${signal.procedureCode}-${signal.source}`}>
              <span className="font-medium">{procedureLabel(signal.procedureCode, language)}: </span>
              {signal.minRupiah === signal.maxRupiah
                ? formatRupiah(signal.minRupiah, language)
                : t("card.guidance.costRange", {
                    min: formatRupiah(signal.minRupiah, language),
                    max: formatRupiah(signal.maxRupiah, language),
                  })}{" "}
              <span className="text-muted-foreground">
                ({t(`shortlist.priceSource.${signal.source}`)}
                {signal.source === "costEstimate" ? `, ${t("estimate")}` : ""}
                {signal.asOf ? `, ${t("shortlist.asOf", { date: signal.asOf })}` : ""})
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={providerPath(provider.placeId)}>{t("provider.viewPage")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={provider.googleMapsUri} target="_blank" rel="noreferrer">
            {t("shortlist.openInMaps")}
          </a>
        </Button>
      </div>
      <GoogleReviews placeId={provider.placeId} />
    </li>
  );
}
