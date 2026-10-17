import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { isLanguage, type Language } from "~/i18n/config";
import { formatRupiah } from "~/lib/format";
import { providerPath, testimonyPath } from "~/lib/paths";
import { procedureLabel } from "~/lib/procedures";
import { regionLabel } from "~/lib/regions";
import type { FeedItem } from "~/server/feed.server";

const ASPECTS = ["service", "hygiene", "materialsEquipment"] as const;

/** "2026-09" as "September 2026"; UTC so server and browser agree. */
function formatVisitMonth(visitMonth: string, language: Language): string {
  const [year, month] = visitMonth.split("-").map(Number);
  if (!year || !month) return visitMonth;
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** One Testimony in the landing feed (spec 04). */
export function TestimonyCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : "id";
  const headingId = `feed-${item.id}`;

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={headingId} className="text-lg font-semibold leading-tight">
            <Link to={providerPath(item.placeId)} className="underline-offset-4 hover:underline">
              {item.providerName}
            </Link>
          </h3>
          {item.verifiedVisit && <Badge>{t("feed.card.verified")}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`filters.providerTypes.${item.providerType}`)} · {regionLabel(item.region)}
        </p>
      </header>

      <dl className="grid grid-cols-3 gap-2 text-sm" aria-label={t("feed.card.ratingsLabel")}>
        {ASPECTS.map((aspect) => (
          <div key={aspect} className="flex flex-col rounded-md bg-secondary px-2 py-1.5">
            <dt className="text-xs text-secondary-foreground">{t(`feed.card.aspects.${aspect}`)}</dt>
            <dd className="font-semibold">
              <span aria-hidden="true">{item.ratings[aspect]}/5</span>
              <span className="sr-only">{t("feed.card.score", { score: item.ratings[aspect] })}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="whitespace-pre-line">{item.excerpt}</p>

      <dl className="flex flex-col gap-1 text-sm">
        {item.procedureCode && (
          <div className="flex flex-wrap gap-x-1">
            <dt className="text-muted-foreground">{t("feed.card.procedure")}:</dt>
            <dd>{procedureLabel(item.procedureCode, language)}</dd>
          </div>
        )}
        {item.pricePaidRupiah !== undefined && (
          <div className="flex flex-wrap gap-x-1">
            <dt className="text-muted-foreground">{t("feed.card.price")}:</dt>
            <dd>{formatRupiah(item.pricePaidRupiah, language)}</dd>
          </div>
        )}
      </dl>

      <footer className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {t("feed.card.visitMonth", { month: formatVisitMonth(item.visitMonth, language) })} ·{" "}
          {t("feed.card.byline", { name: item.displayName })}
        </span>
        <Link
          to={testimonyPath(item.placeId, item.id)}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("feed.card.readMore")}
          <span className="sr-only">: {item.providerName}</span>
        </Link>
      </footer>
    </article>
  );
}
