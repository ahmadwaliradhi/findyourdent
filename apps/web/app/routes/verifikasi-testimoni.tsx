import { useTranslation } from "react-i18next";
import { LegalPage } from "~/components/legal-page";
import { getI18n, type Language } from "~/i18n/config";
import { SITE_NAME } from "~/lib/seo";
import type { Route } from "./+types/verifikasi-testimoni";

/**
 * 'Cara kami memverifikasi testimoni' (spec 09): what counts, how a Proof of Visit is checked
 * and kept, the minimum of three and the Testimony policy. Indexable and in the sitemap. It
 * never states detection thresholds.
 */
export function meta({ matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [
    { title: `${t("transparency.metaTitle")} | ${SITE_NAME}` },
    { name: "description", content: t("transparency.lead") },
  ];
}

export default function TransparencyPage() {
  const { t } = useTranslation();
  return (
    <LegalPage
      title={t("transparency.title")}
      lead={t("transparency.lead")}
      dates={{ effective: t("transparency.effective"), updated: t("transparency.updated") }}
      sections={t("transparency.sections", { returnObjects: true })}
      seeAlso={{ to: "/syarat", label: t("transparency.seeAlso") }}
    />
  );
}
