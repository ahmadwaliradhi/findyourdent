import { useTranslation } from "react-i18next";
import { LegalPage } from "~/components/legal-page";
import { getI18n, type Language } from "~/i18n/config";
import { SITE_NAME } from "~/lib/seo";
import type { Route } from "./+types/privasi";

/** Privacy policy (spec 08). A draft until legal review: noindex and out of the sitemap. */
export function meta({ matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [
    { title: `${t("privacy.metaTitle")} | ${SITE_NAME}` },
    { name: "description", content: t("privacy.lead") },
    { name: "robots", content: "noindex" },
  ];
}

export default function Privacy() {
  const { t } = useTranslation();
  return (
    <LegalPage
      title={t("privacy.title")}
      lead={t("privacy.lead")}
      sections={t("privacy.sections", { returnObjects: true })}
      seeAlso={{ to: "/syarat", label: t("privacy.seeAlso") }}
    />
  );
}
