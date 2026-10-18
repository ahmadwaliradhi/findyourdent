import type { TFunction } from "i18next";
import { Check, ChevronLeft, Clock, Info, MapPin, MessageCircle, Phone, Star } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";
import { GoogleReviews } from "~/components/google-reviews";
import { NotEnoughProven, ProofLabel } from "~/components/proof-label";
import { ReportButton } from "~/components/report-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { AspectRatings, FactList } from "~/components/ui/testimony-card";
import { getI18n, type Language } from "~/i18n/config";
import { ASPECTS } from "~/lib/aspects";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatDate, formatRupiah, formatScore, formatVisitMonth } from "~/lib/format";
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
        count: provider.verifiedVisitCount,
      })
    : t("provider.metaDescriptionNoScores", { name: provider.name, area: provider.area });
  return [
    { title: `${title} | ${SITE_NAME}` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    ...openGraphMeta({ title, description, url }),
  ];
}

/** The mockup's h2 for main-column sections and the smaller h3-sized one for aside cards. */
const SECTION_TITLE = "text-[22px] leading-7 font-bold tracking-[-.01em]";
const ASIDE_TITLE = "text-lg leading-6 font-[650]";

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
  const claim = provider?.claimed
    ? ({ hint: "provider.ownerHint", cta: "provider.manageCta" } as const)
    : ({ hint: "provider.claimHint", cta: "provider.claimCta" } as const);
  const hasPrices = Boolean(provider && (provider.priceSignals.length > 0 || provider.priceList));

  return (
    <div className="flex flex-col gap-8" data-place-id={placeId}>
      <header className="flex flex-col gap-3">
        <Link
          to="/direktori"
          className="inline-flex min-h-touch items-center gap-1 self-start font-semibold text-foreground no-underline"
        >
          <ChevronLeft aria-hidden="true" strokeWidth={1.75} className="size-5" />
          {t("nav.directory")}
        </Link>
        {(providerType || provider?.claimed) && (
          <div className="flex flex-wrap gap-2">
            {providerType && (
              <Badge variant="neutral">
                {t(`provider.type.${providerType}`)}
                {typeInferred && ` (${t("provider.typeInferred")})`}
              </Badge>
            )}
            {provider?.claimed && (
              <Badge variant="brand" icon={Check}>
                {t("provider.claimed")}
              </Badge>
            )}
          </div>
        )}
        <h1 className="text-[28px] leading-[34px] font-bold tracking-[-.015em]">{name}</h1>
        {provider && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
            {provider.area}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {whatsappUri && (
            <Button asChild>
              <a href={whatsappUri} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden="true" strokeWidth={1.75} />
                {t("provider.whatsapp")}
              </a>
            </Button>
          )}
          {phone && (
            <Button asChild variant={whatsappUri ? "outline" : "primary"}>
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                <Phone aria-hidden="true" strokeWidth={1.75} />
                {t("provider.call")} {phone}
              </a>
            </Button>
          )}
          <Button asChild variant="ghost">
            <a href={mapsUri} target="_blank" rel="noreferrer">
              {t("shortlist.openInMaps")}
            </a>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 desktop:grid-cols-[minmax(0,1fr)_360px] desktop:items-start desktop:gap-10">
        <div className="flex flex-col gap-8">
          {provider && <Aspects provider={provider} language={language} />}

          {provider && hasPrices && (
            <Prices signals={provider.priceSignals} list={provider.priceList} language={language} />
          )}

          <section aria-labelledby="testimonies-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="testimonies-title" className={SECTION_TITLE}>
                {t("provider.testimoniesTitle")}
              </h2>
              <Button asChild variant="secondary" size="sm">
                <Link to={`/ceritakan?placeId=${encodeURIComponent(placeId)}`}>{t("testimonyForm.entryCta")}</Link>
              </Button>
            </div>
            {!provider ? (
              <p className="text-muted-foreground">{t("provider.notListed")}</p>
            ) : testimonies.length === 0 ? (
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
        </div>

        <aside className="flex flex-col gap-4">
          {provider?.owner && <OwnerInfo owner={provider.owner} language={language} />}

          <Card labelledBy="google-title" aria-busy={block.phase === "loading"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="google-title" className={ASIDE_TITLE}>
                {t("provider.googleTitle")}
              </h2>
              {google?.openNow !== undefined &&
                (google.openNow ? (
                  <Badge variant="success">{t("provider.openNow")}</Badge>
                ) : (
                  <Badge variant="neutral" icon={Clock}>
                    {t("provider.closedNow")}
                  </Badge>
                ))}
            </div>
            <div aria-live="polite">
              {block.phase === "loading" && (
                <p className="text-sm text-muted-foreground">{t("provider.googleLoading")}</p>
              )}
              {(block.phase === "error" || (block.phase === "done" && !block.result.available)) && (
                <p className="flex items-start gap-1.5 text-sm">
                  <Info aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-info" />
                  {t("provider.googleUnavailable")}
                </p>
              )}
              {google && <GoogleFacts block={google} language={language} />}
            </div>
            <GoogleReviews placeId={placeId} />
            <p className="text-xs font-medium text-muted-foreground">{t("provider.attribution")}</p>
          </Card>

          <Card variant="flat" className="gap-2 border-transparent bg-muted">
            <p>{t(claim.hint)}</p>
            <Button asChild variant="ghost" size="sm" className="self-start">
              <Link to={`${providerPath(placeId)}/klaim`}>{t(claim.cta)}</Link>
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Aspects({ provider, language }: { provider: ProviderSummary; language: Language }) {
  const { t } = useTranslation();
  const { averages } = provider;
  return (
    <Card labelledBy="aspects-title" className="desktop:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="aspects-title" className={SECTION_TITLE}>
          {t("provider.aspectsTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t("provider.testimonyCount", { count: provider.testimonyCount })}
          {/* Without averages the Proven count is in the card body. */}
          {averages && ` · ${t("provider.verifiedVisitCount", { count: provider.verifiedVisitCount })}`}
        </span>
      </div>
      {averages ? (
        <>
          <dl className="flex flex-col gap-3">
            {ASPECTS.map((aspect) => (
              <div key={aspect} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
                <dt className="text-sm font-semibold">{t(`provider.aspects.${aspect}`)}</dt>
                <dd className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3">
                  <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(averages[aspect] / 5) * 100}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold tabular-nums">
                    {formatScore(averages[aspect], language)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs font-medium text-muted-foreground">{t("provider.scoreScale")}</p>
        </>
      ) : (
        <NotEnoughProven count={provider.verifiedVisitCount} className="text-muted-foreground" />
      )}
    </Card>
  );
}

function rangeText(min: number, max: number, language: Language, t: TFunction) {
  return min === max
    ? formatRupiah(min, language)
    : t("card.guidance.costRange", { min: formatRupiah(min, language), max: formatRupiah(max, language) });
}

function Prices({
  signals,
  list,
  language,
}: {
  signals: PriceSignal[];
  list: PublicPriceList | undefined | null;
  language: Language;
}) {
  const { t } = useTranslation();
  return (
    <Card labelledBy="prices-title" className="desktop:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="prices-title" className={SECTION_TITLE}>
          {t("provider.pricesTitle")}
        </h2>
        {list && (
          <Badge variant="success">
            {t("provider.priceListConfirmed", { date: formatDate(list.confirmedAt, language) })}
          </Badge>
        )}
      </div>
      {list && (
        <div className="flex flex-col gap-2" data-testid="owner-price-list">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t("provider.priceListTitle")}</h3>
            {list.possiblyOutdated && <Badge variant="warning">{t("provider.possiblyOutdated")}</Badge>}
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {list.rows.map((row, index) => (
              // Rows have no id; the list is replaced as a whole, never reordered in place.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={index} className="flex flex-col gap-1 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span>{row.procedureText}</span>
                  <span className="font-semibold tabular-nums">
                    {rangeText(row.minRupiah, row.maxRupiah, language, t)}{" "}
                    <span className="font-normal text-muted-foreground">{t(`priceList.units.${row.unit}`)}</span>
                  </span>
                </div>
                {row.notes && <p className="text-sm text-muted-foreground">{row.notes}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {signals.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {signals.map((signal) => (
            <li key={`${signal.procedureCode}-${signal.source}`}>
              <span className="text-muted-foreground">
                {t(`shortlist.priceSource.${signal.source}`)}, {procedureLabel(signal.procedureCode, language)}:
              </span>{" "}
              <b className="tabular-nums">{rangeText(signal.minRupiah, signal.maxRupiah, language, t)}</b>
              {signal.asOf && (
                <span className="text-muted-foreground">
                  {" "}
                  ({t("shortlist.asOf", { date: formatDate(signal.asOf, language) })})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OwnerInfo({ owner, language }: { owner: NonNullable<ProviderSummary["owner"]>; language: Language }) {
  const { t } = useTranslation();
  const facts: { label: string; value: ReactNode }[] = [];
  if (owner.address) facts.push({ label: t("provider.address"), value: owner.address });
  if (owner.openingHours) facts.push({ label: t("provider.hours"), value: owner.openingHours });
  if (owner.services) {
    facts.push({
      label: t("provider.services"),
      value: owner.services.map((code) => procedureLabel(code, language)).join(", "),
    });
  }
  if (owner.website) {
    facts.push({
      label: t("provider.website"),
      value: (
        <a
          href={owner.website}
          target="_blank"
          rel="noreferrer nofollow"
          className="inline-flex min-h-touch items-center break-all underline"
        >
          {owner.website}
        </a>
      ),
    });
  }
  return (
    <Card labelledBy="owner-title">
      <h2 id="owner-title" className={ASIDE_TITLE}>
        {t("provider.ownerTitle")}
      </h2>
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          {facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="whitespace-pre-line">{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Card>
  );
}

function GoogleFacts({ block, language }: { block: ProviderGoogleBlock; language: Language }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-sm">
      {block.formattedAddress && <p>{block.formattedAddress}</p>}
      {block.rating !== undefined && (
        <p className="flex items-center gap-1.5">
          <Star aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 fill-star text-star" />
          {t("provider.rating", {
            rating: formatScore(block.rating, language),
            count: block.userRatingCount ?? 0,
          })}
        </p>
      )}
      {block.weekdayHours && (
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{t("provider.hours")}</p>
          {block.weekdayHours.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {block.nationalPhoneNumber && <p className="tabular-nums">{block.nationalPhoneNumber}</p>}
      {block.websiteUri && (
        <p>
          <a
            href={block.websiteUri}
            target="_blank"
            rel="noreferrer nofollow"
            className="inline-flex min-h-touch items-center underline"
          >
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
  const facts = [];
  if (testimony.procedureCode) {
    facts.push({ label: t("feed.card.procedure"), value: procedureLabel(testimony.procedureCode, language) });
  }
  if (testimony.pricePaidRupiah !== undefined) {
    facts.push({ label: t("feed.card.price"), value: formatRupiah(testimony.pricePaidRupiah, language) });
  }
  return (
    <article
      aria-label={testimony.displayName}
      className="flex flex-col gap-3 rounded-lg border bg-card p-5 text-card-foreground shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{testimony.displayName}</span>
          <ProofLabel proven={testimony.verifiedVisit} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("provider.visitMonth", { month: formatVisitMonth(testimony.visitMonth, language) })}
        </p>
      </div>
      <AspectRatings
        label={t("provider.ratingsLabel", { name: testimony.displayName })}
        ratings={ASPECTS.map((aspect) => ({
          label: t(`provider.aspects.${aspect}`),
          score: testimony.ratings[aspect],
          spokenScore: t("feed.card.score", { score: testimony.ratings[aspect] }),
        }))}
      />
      <p className="whitespace-pre-line">{testimony.text}</p>
      <FactList facts={facts} />
      {testimony.reply && (
        <div className="ml-3 flex flex-col gap-1 rounded-md border bg-background px-3.5 py-3 text-sm">
          <p className="font-semibold">{t("provider.reply")}</p>
          <p className="whitespace-pre-line break-words">{testimony.reply}</p>
        </div>
      )}
      <div className="flex justify-end">
        <ReportButton testimonyId={testimony.id} />
      </div>
    </article>
  );
}
