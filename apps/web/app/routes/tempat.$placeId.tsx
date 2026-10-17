import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";
import { GoogleReviews } from "~/components/google-reviews";
import { ReportButton } from "~/components/report-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getI18n, type Language } from "~/i18n/config";
import { ASPECTS } from "~/lib/aspects";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatRupiah, formatScore, formatVisitMonth } from "~/lib/format";
import { fetchGoogleRoute } from "~/lib/google-routes";
import { providerPath } from "~/lib/paths";
import type { PublicPriceList } from "~/lib/price-lists";
import { procedureLabel } from "~/lib/procedures";
import type { GoogleBlockResponse, ProviderGoogleBlock } from "~/lib/provider";
import { openGraphMeta, SITE_NAME } from "~/lib/seo";
import type { PriceSignal } from "~/lib/shortlist";
import { isPlaceId, UNNAMED_MAPS_QUERY } from "~/server/provider.server";
import { loadProviderPage, type ProviderSummary } from "~/server/provider-page.server";
import { placeMapsUrl } from "~/server/shortlist.server";
import type { Route } from "./+types/tempat.$placeId";

/**
 * Provider page (spec 02), keyed by place_id. FindYourDent's own content is rendered
 * on the server with no Places call; the Google block loads in the browser through
 * an App Check-protected route, and Google Reviews only on a tap. A place that is
 * not a Listed Provider (reached from a Shortlist) still has a page, but noindex.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isPlaceId(params.placeId)) throw data(null, { status: 404 });
  const page = context.firestore ? await loadProviderPage(context.firestore, params.placeId) : null;
  return {
    url: `${new URL(request.url).origin}${providerPath(params.placeId)}`,
    placeId: params.placeId,
    provider: page?.provider ?? null,
    testimonies: page?.testimonies ?? [],
    googleMapsUri: page?.provider.googleMapsUri ?? placeMapsUrl(UNNAMED_MAPS_QUERY, params.placeId),
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: SITE_NAME }];
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const { provider, url } = loaderData;
  if (!provider) {
    // No FindYourDent content: a page of Google facts must not be indexed (spec 02).
    return [
      { title: `${t("provider.unnamed")} | ${SITE_NAME}` },
      { name: "description", content: t("provider.metaDescriptionUnlisted") },
      { name: "robots", content: "noindex" },
    ];
  }
  const title = t("provider.title", { name: provider.name, area: provider.area });
  const description = provider.averages
    ? t("provider.metaDescription", {
        name: provider.name,
        area: provider.area,
        service: formatScore(provider.averages.service, language),
        hygiene: formatScore(provider.averages.hygiene, language),
        materials: formatScore(provider.averages.materialsEquipment, language),
        count: provider.testimonyCount,
      })
    : t("provider.metaDescriptionNoScores", { name: provider.name, area: provider.area });
  return [
    { title: `${title} | ${SITE_NAME}` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    ...openGraphMeta({ title, description, url }),
  ];
}

type BlockState = { phase: "loading" } | { phase: "done"; result: GoogleBlockResponse } | { phase: "error" };

export default function ProviderPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language as Language;
  const { provider, testimonies, placeId } = loaderData;
  const firebase = useFirebaseConfig();
  const [block, setBlock] = useState<BlockState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setBlock({ phase: "loading" });
    fetchGoogleRoute<GoogleBlockResponse>(firebase, placeId, "google")
      .then((result) => !cancelled && setBlock({ phase: "done", result }))
      .catch(() => !cancelled && setBlock({ phase: "error" }));
    return () => {
      cancelled = true;
    };
  }, [firebase, placeId]);

  const google = block.phase === "done" && block.result.available ? block.result.block : null;
  const name = provider?.name ?? google?.displayName ?? t("provider.unnamed");
  const providerType = provider?.providerType ?? google?.providerType;
  // Without a Listed Provider the type always comes from the inference rule.
  const typeInferred = provider ? provider.providerTypeInferred : true;
  const phone = provider?.owner?.phone ?? google?.nationalPhoneNumber;
  const whatsappUri = provider?.owner?.whatsappUri ?? google?.whatsappUri;
  const mapsUri = google?.googleMapsUri ?? loaderData.googleMapsUri;

  return (
    <div className="flex flex-col gap-6" data-place-id={placeId}>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{name}</h1>
        {provider && <p className="text-muted-foreground">{provider.area}</p>}
        <div className="flex flex-wrap gap-2">
          {providerType && (
            <Badge variant="secondary">
              {t(`provider.type.${providerType}`)}
              {typeInferred && ` (${t("provider.typeInferred")})`}
            </Badge>
          )}
          {provider?.claimed && <Badge>{t("provider.claimed")}</Badge>}
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

      {provider ? <Aspects provider={provider} language={language} /> : <p>{t("provider.notListed")}</p>}

      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed px-4 py-3">
        <p className="text-sm text-muted-foreground">{t("testimonyForm.entryHint")}</p>
        <Button asChild size="sm">
          <Link to={`/ceritakan?placeId=${encodeURIComponent(placeId)}`}>{t("testimonyForm.entryCta")}</Link>
        </Button>
      </div>

      {provider && provider.priceSignals.length > 0 && <Prices signals={provider.priceSignals} language={language} />}

      {provider?.priceList && <OwnerPriceList list={provider.priceList} language={language} />}

      {provider?.owner && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="text-lg font-semibold">{t("provider.ownerTitle")}</h2>
          {provider.owner.address && <p>{provider.owner.address}</p>}
          {provider.owner.openingHours && <p className="whitespace-pre-line">{provider.owner.openingHours}</p>}
          {provider.owner.services && (
            <p>
              {t("provider.services", {
                services: provider.owner.services.map((code) => procedureLabel(code, language)).join(", "),
              })}
            </p>
          )}
          {provider.owner.website && (
            <a href={provider.owner.website} target="_blank" rel="noreferrer nofollow" className="underline">
              {provider.owner.website}
            </a>
          )}
        </section>
      )}

      {provider && (
        <section aria-labelledby="testimonies-title" className="flex flex-col gap-3">
          <h2 id="testimonies-title" className="text-lg font-semibold">
            {t("provider.testimoniesTitle")}
          </h2>
          {testimonies.length === 0 ? (
            <p className="text-muted-foreground">{t("provider.noTestimonies")}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {testimonies.map((testimony) => (
                <li key={testimony.id} id={`testimoni-${testimony.id}`} className="scroll-mt-4">
                  <TestimonyItem testimony={testimony} language={language} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <p className="text-sm text-muted-foreground">
        {provider?.claimed ? t("provider.ownerHint") : t("provider.claimHint")}{" "}
        <Link to={`${providerPath(placeId)}/klaim`} className="font-medium text-foreground underline">
          {provider?.claimed ? t("provider.manageCta") : t("provider.claimCta")}
        </Link>
      </p>

      <section
        aria-labelledby="google-title"
        className="flex flex-col gap-3 rounded-md border px-4 py-4"
        aria-busy={block.phase === "loading"}
      >
        <h2 id="google-title" className="text-lg font-semibold">
          {t("provider.googleTitle")}
        </h2>
        <div aria-live="polite">
          {block.phase === "loading" && <p className="text-sm text-muted-foreground">{t("provider.googleLoading")}</p>}
          {(block.phase === "error" || (block.phase === "done" && !block.result.available)) && (
            <p className="text-sm">{t("provider.googleUnavailable")}</p>
          )}
          {google && <GoogleFacts block={google} language={language} />}
        </div>
        <GoogleReviews placeId={placeId} />
        <p className="text-xs text-muted-foreground">{t("provider.attribution")}</p>
      </section>
    </div>
  );
}

function Aspects({ provider, language }: { provider: ProviderSummary; language: Language }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="aspects-title" className="flex flex-col gap-2">
      <h2 id="aspects-title" className="text-lg font-semibold">
        {t("provider.aspectsTitle")}
      </h2>
      {provider.averages ? (
        <dl className="grid grid-cols-3 gap-3">
          {ASPECTS.map((aspect) => (
            <div key={aspect} className="rounded-md border bg-card p-3">
              <dt className="text-xs text-muted-foreground">{t(`provider.aspects.${aspect}`)}</dt>
              <dd className="text-xl font-bold">{formatScore(provider.averages?.[aspect] ?? 0, language)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">{t("provider.noScores")}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("provider.testimonyCount", { count: provider.testimonyCount })} ·{" "}
        {t("provider.verifiedVisitCount", { count: provider.verifiedVisitCount })}
      </p>
    </section>
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

function OwnerPriceList({ list, language }: { list: PublicPriceList; language: Language }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2" data-testid="owner-price-list">
      <h2 className="text-lg font-semibold">{t("provider.priceListTitle")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("provider.priceListConfirmed", { date: list.confirmedAt })}
        {list.possiblyOutdated && (
          <>
            {" · "}
            <span className="font-medium text-foreground">{t("provider.possiblyOutdated")}</span>
          </>
        )}
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {list.rows.map((row, index) => (
          // Rows have no id; the list is replaced as a whole, never reordered in place.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <li key={index}>
            <span className="font-medium">{row.procedureText}: </span>
            {row.minRupiah === row.maxRupiah
              ? formatRupiah(row.minRupiah, language)
              : t("card.guidance.costRange", {
                  min: formatRupiah(row.minRupiah, language),
                  max: formatRupiah(row.maxRupiah, language),
                })}{" "}
            <span className="text-muted-foreground">{t(`priceList.units.${row.unit}`)}</span>
            {row.notes && <p className="text-muted-foreground">{row.notes}</p>}
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

type PublicTestimony = Route.ComponentProps["loaderData"]["testimonies"][number];

function TestimonyItem({ testimony, language }: { testimony: PublicTestimony; language: Language }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {testimony.displayName}
          {testimony.verifiedVisit && <Badge variant="outline">{t("provider.verifiedVisit")}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("provider.visitMonth", { month: formatVisitMonth(testimony.visitMonth, language) })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
          aria-label={t("provider.ratingsLabel", { name: testimony.displayName })}
        >
          {ASPECTS.map((aspect) => (
            <div key={aspect} className="flex gap-1">
              <dt className="text-muted-foreground">{t(`provider.aspects.${aspect}`)}</dt>
              <dd className="font-medium">{testimony.ratings[aspect]}/5</dd>
            </div>
          ))}
        </dl>
        <p className="whitespace-pre-line">{testimony.text}</p>
        {(testimony.procedureCode || testimony.pricePaidRupiah !== undefined) && (
          <p className="text-sm text-muted-foreground">
            {testimony.procedureCode &&
              t("provider.procedure", { procedure: procedureLabel(testimony.procedureCode, language) })}
            {testimony.procedureCode && testimony.pricePaidRupiah !== undefined && " · "}
            {testimony.pricePaidRupiah !== undefined &&
              t("provider.pricePaid", { price: formatRupiah(testimony.pricePaidRupiah, language) })}
          </p>
        )}
        {testimony.reply && (
          <div className="border-l-2 pl-3 text-sm">
            <p className="font-medium">{t("provider.reply")}</p>
            <p className="whitespace-pre-line break-words">{testimony.reply}</p>
          </div>
        )}
        <ReportButton testimonyId={testimony.id} />
      </CardContent>
    </Card>
  );
}
