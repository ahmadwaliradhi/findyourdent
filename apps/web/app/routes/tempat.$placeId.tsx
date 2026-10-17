import { useTranslation } from "react-i18next";
import { data } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getI18n, type Language } from "~/i18n/config";
import { ASPECTS } from "~/lib/aspects";
import { formatRupiah, formatScore, formatVisitMonth } from "~/lib/format";
import { providerPath } from "~/lib/paths";
import { procedureLabel } from "~/lib/procedures";
import { openGraphMeta, SITE_NAME } from "~/lib/seo";
import { loadProviderPage } from "~/server/provider-page.server";
import type { Route } from "./+types/tempat.$placeId";

/** Listed Provider page (spec 02). 404 for a place that is not a Listed Provider. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const page = context.firestore ? await loadProviderPage(context.firestore, params.placeId) : null;
  if (!page) throw data(null, { status: 404 });
  return { url: `${new URL(request.url).origin}${providerPath(params.placeId)}`, ...page };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: SITE_NAME }];
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const { provider, url } = loaderData;
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

export default function ProviderPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language as Language;
  const { provider, testimonies } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{provider.name}</h1>
        <p className="text-muted-foreground">{provider.area}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {t(`provider.type.${provider.providerType}`)}
            {provider.providerTypeInferred && ` (${t("provider.typeInferred")})`}
          </Badge>
          {provider.claimed && <Badge>{t("provider.claimed")}</Badge>}
        </div>
      </header>

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

      {/* T10: Google block (Place Details, App Check gated, never stored) goes here. */}

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
      </CardContent>
    </Card>
  );
}
