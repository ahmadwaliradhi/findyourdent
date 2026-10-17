import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { GoogleReviews } from "~/components/google-reviews";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { getI18n, type Language } from "~/i18n/config";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatRupiah, formatScore } from "~/lib/format";
import { fetchGoogleRoute } from "~/lib/google-routes";
import { procedureLabel } from "~/lib/procedures";
import type { GoogleBlockResponse, ProviderGoogleBlock, ProviderPageData, PublicTestimony } from "~/lib/provider";
import type { PriceSignal } from "~/lib/shortlist";
import { isPlaceId, loadProviderPage } from "~/server/provider.server";
import type { Route } from "./+types/provider.$placeId";

/**
 * Provider page (spec 02), keyed by place_id. FindYourDent's content is rendered
 * here on the server without any Places call; the Google block loads in the browser
 * through an App Check-protected route, and Google Reviews only on a tap.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isPlaceId(params.placeId)) throw data(null, { status: 404 });
  return loadProviderPage(context, params.placeId);
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  if (!loaderData?.listed || !loaderData.name) {
    // No FindYourDent content: a page of Google facts must not be indexed (spec 02).
    return [
      { title: `${t("provider.unnamed")} | FindYourDent` },
      { name: "description", content: t("provider.metaDescriptionUnlisted") },
      { name: "robots", content: "noindex" },
    ];
  }
  const description = t("provider.metaDescription", {
    name: loaderData.name,
    region: loaderData.regionName ?? "Indonesia",
  });
  return [
    { title: `${loaderData.name} | FindYourDent` },
    { name: "description", content: description },
    { property: "og:title", content: loaderData.name },
    { property: "og:description", content: description },
  ];
}

type BlockState = { phase: "loading" } | { phase: "done"; result: GoogleBlockResponse } | { phase: "error" };

export default function ProviderPage({ loaderData: page }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === "en" ? "en" : "id") as Language;
  const firebase = useFirebaseConfig();
  const [block, setBlock] = useState<BlockState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setBlock({ phase: "loading" });
    fetchGoogleRoute<GoogleBlockResponse>(firebase, page.placeId, "google")
      .then((result) => !cancelled && setBlock({ phase: "done", result }))
      .catch(() => !cancelled && setBlock({ phase: "error" }));
    return () => {
      cancelled = true;
    };
  }, [firebase, page.placeId]);

  const google = block.phase === "done" && block.result.available ? block.result.block : null;
  const name = page.name ?? google?.displayName ?? t("provider.unnamed");
  const providerType = page.providerType ?? google?.providerType;
  const phone = page.owner?.phone ?? google?.nationalPhoneNumber;
  const whatsappUri = page.owner?.whatsappUri ?? google?.whatsappUri;
  const mapsUri = google?.googleMapsUri ?? page.googleMapsUri;

  return (
    <article className="flex flex-col gap-6" data-place-id={page.placeId}>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{name}</h1>
        {page.regionName && <p className="text-muted-foreground">{page.regionName}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {providerType && <Badge variant="secondary">{t(`shortlist.type.${providerType}`)}</Badge>}
          {providerType && page.providerTypeSource !== "claimed" && (
            <Badge variant="outline">{t("shortlist.estimated")}</Badge>
          )}
          {page.claimed && <Badge>{t("shortlist.claimed")}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {phone && (
            <Button asChild size="sm">
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                {t("provider.call")} {phone}
              </a>
            </Button>
          )}
          {whatsappUri && (
            <Button asChild size="sm" variant="secondary">
              <a href={whatsappUri} target="_blank" rel="noreferrer">
                {t("provider.whatsapp")}
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <a href={mapsUri} target="_blank" rel="noreferrer">
              {t("shortlist.openInMaps")}
            </a>
          </Button>
        </div>
      </header>

      <Testimonies page={page} language={language} />
      {page.priceSignals.length > 0 && <Prices signals={page.priceSignals} language={language} />}
      {page.owner && Object.keys(page.owner).length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="text-lg font-semibold">{t("provider.ownerTitle")}</h2>
          {page.owner.address && <p>{page.owner.address}</p>}
          {page.owner.openingHours && <p className="whitespace-pre-line">{page.owner.openingHours}</p>}
          {page.owner.website && (
            <a href={page.owner.website} target="_blank" rel="noreferrer nofollow" className="underline">
              {page.owner.website}
            </a>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-md border px-4 py-4" aria-busy={block.phase === "loading"}>
        <h2 className="text-lg font-semibold">{t("provider.googleTitle")}</h2>
        <div aria-live="polite">
          {block.phase === "loading" && <p className="text-sm text-muted-foreground">{t("provider.googleLoading")}</p>}
          {(block.phase === "error" || (block.phase === "done" && !block.result.available)) && (
            <p className="text-sm">{t("provider.googleUnavailable")}</p>
          )}
          {google && <GoogleFacts block={google} language={language} />}
        </div>
        <GoogleReviews placeId={page.placeId} />
        <p className="text-xs text-muted-foreground">{t("provider.attribution")}</p>
      </section>
    </article>
  );
}

function Testimonies({ page, language }: { page: ProviderPageData; language: Language }) {
  const { t } = useTranslation();
  const { testimonies } = page;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("provider.testimoniesTitle")}</h2>
      {!page.listed && <p className="text-sm text-muted-foreground">{t("provider.notListed")}</p>}
      {page.listed && testimonies.count > 0 && (
        <div className="text-sm">
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
        </div>
      )}
      {page.listed && page.testimonyList.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("provider.testimoniesEmpty")}</p>
      )}
      {page.testimonyList.length > 0 && (
        <ul className="flex flex-col gap-3">
          {page.testimonyList.map((testimony) => (
            <TestimonyItem key={testimony.id} testimony={testimony} language={language} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TestimonyItem({ testimony, language }: { testimony: PublicTestimony; language: Language }) {
  const { t } = useTranslation();
  const { ratings } = testimony;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{testimony.displayName}</span>
        {testimony.verifiedVisit && <Badge variant="secondary">{t("provider.verifiedVisit")}</Badge>}
        <span className="text-muted-foreground">{t("provider.visit", { month: testimony.visitMonth })}</span>
      </div>
      <p className="text-muted-foreground">
        {t("shortlist.aspects", {
          service: formatScore(ratings.service, language),
          hygiene: formatScore(ratings.hygiene, language),
          materials: formatScore(ratings.materialsEquipment, language),
        })}
      </p>
      {(testimony.procedureCode || testimony.pricePaidRupiah !== undefined) && (
        <p>
          {testimony.procedureCode && procedureLabel(testimony.procedureCode, language)}
          {testimony.procedureCode && testimony.pricePaidRupiah !== undefined && " · "}
          {testimony.pricePaidRupiah !== undefined &&
            t("provider.paid", { price: formatRupiah(testimony.pricePaidRupiah, language) })}
        </p>
      )}
      <p className="whitespace-pre-line break-words">{testimony.text}</p>
      {testimony.reply && (
        <div className="border-l-2 pl-3">
          <p className="font-medium">{t("provider.reply")}</p>
          <p className="whitespace-pre-line break-words">{testimony.reply}</p>
        </div>
      )}
    </li>
  );
}

function Prices({ signals, language }: { signals: PriceSignal[]; language: Language }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("provider.pricesTitle")}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {signals.map((signal) => (
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
              {signal.asOf ? `, ${t("shortlist.asOf", { date: signal.asOf })}` : ""})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GoogleFacts({ block, language }: { block: ProviderGoogleBlock; language: Language }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-sm">
      {block.formattedAddress && <p>{block.formattedAddress}</p>}
      {block.rating !== undefined && (
        <p>
          {t("provider.rating", {
            rating: formatScore(block.rating, language),
            count: block.userRatingCount ?? 0,
          })}
        </p>
      )}
      {(block.openNow !== undefined || block.weekdayHours) && (
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">
            {t("provider.hours")}
            {block.openNow !== undefined && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {block.openNow ? t("provider.openNow") : t("provider.closedNow")}
              </span>
            )}
          </p>
          {block.weekdayHours?.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {block.nationalPhoneNumber && <p>{block.nationalPhoneNumber}</p>}
      {block.websiteUri && (
        <p>
          <a href={block.websiteUri} target="_blank" rel="noreferrer nofollow" className="underline">
            {t("provider.website")}
          </a>
        </p>
      )}
    </div>
  );
}
