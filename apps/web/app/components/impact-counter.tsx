import { useTranslation } from "react-i18next";
import { isLanguage, type Language } from "~/i18n/config";
import { formatCount } from "~/lib/format";
import type { ImpactCounts } from "~/lib/impact";

const ITEMS = [
  "testimoniesPublished",
  "kotaCovered",
  "verifiedVisits",
  "listedProviders",
  "guidanceSessionsCompleted",
] as const satisfies readonly (keyof ImpactCounts)[];

/** The live impact counter (spec 04): five labelled numbers. */
export function ImpactCounter({ counts }: { counts: ImpactCounts }) {
  const { t, i18n } = useTranslation();
  const language: Language = isLanguage(i18n.language) ? i18n.language : "id";
  return (
    <section aria-labelledby="impact-title" className="flex flex-col gap-2">
      <h2 id="impact-title" className="sr-only">
        {t("impact.title")}
      </h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="impact-counter">
        {ITEMS.map((key) => (
          <div key={key} className="flex flex-col-reverse rounded-md border bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(`impact.${key}`)}</dt>
            <dd className="text-xl font-bold tabular-nums" data-counter={key}>
              {formatCount(counts[key], language)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
