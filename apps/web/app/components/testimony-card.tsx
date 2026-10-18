import { useTranslation } from "react-i18next";
import { TestimonyCard as TestimonyCardView } from "~/components/ui/testimony-card";
import { isLanguage } from "~/i18n/config";
import { ASPECTS } from "~/lib/aspects";
import type { FeedItem } from "~/lib/feed";
import { formatRupiah, formatVisitMonth } from "~/lib/format";
import { providerPath, testimonyPath } from "~/lib/paths";
import { procedureLabel } from "~/lib/procedures";
import { regionLabel } from "~/lib/regions";

/** One Testimony in the landing feed (spec 04). */
export function TestimonyCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : "id";

  const facts = [];
  if (item.procedureCode) {
    facts.push({ label: t("feed.card.procedure"), value: procedureLabel(item.procedureCode, language) });
  }
  if (item.pricePaidRupiah !== undefined) {
    facts.push({ label: t("feed.card.price"), value: formatRupiah(item.pricePaidRupiah, language) });
  }

  return (
    <TestimonyCardView
      id={`feed-${item.id}`}
      providerName={item.providerName}
      href={providerPath(item.placeId)}
      meta={`${t(`filters.providerTypes.${item.providerType}`)} · ${regionLabel(item.region)}`}
      verifiedLabel={item.verifiedVisit ? t("feed.card.verified") : undefined}
      ratingsLabel={t("feed.card.ratingsLabel")}
      ratings={ASPECTS.map((aspect) => ({
        label: t(`feed.card.aspects.${aspect}`),
        score: item.ratings[aspect],
        spokenScore: t("feed.card.score", { score: item.ratings[aspect] }),
      }))}
      excerpt={item.excerpt}
      facts={facts}
      byline={`${t("feed.card.visitMonth", { month: formatVisitMonth(item.visitMonth, language) })} · ${t("feed.card.byline", { name: item.displayName })}`}
      readMore={{
        href: testimonyPath(item.placeId, item.id),
        label: t("feed.card.readMore"),
        srSuffix: item.providerName,
      }}
    />
  );
}
