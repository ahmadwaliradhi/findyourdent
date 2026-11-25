// The public side of a confirmed Testimony Policy Violation (spec 09 part 2, issue #138).
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui/badge";
import { isLanguage } from "~/i18n/config";
import { formatDay } from "~/lib/format";

/** Shown next to the proof label of a Testimony left out of the score by a confirmed violation (spec 09 Part 2). */
export function ExcludedLabel({ excluded }: { excluded: boolean }) {
  const { t } = useTranslation();
  if (!excluded) return null;
  return <Badge variant="warning">{t("violation.excluded")}</Badge>;
}

/** "Pelanggaran kebijakan testimoni" with its end date, on the Provider page and directory rows. */
export function ViolationBadge({ until }: { until: string }) {
  const { t, i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : "id";
  return (
    <Badge variant="danger" data-testid="violation-badge">
      {t("violation.badge")} · {t("violation.until", { date: formatDay(until, language) })}
    </Badge>
  );
}
