import { useTranslation } from "react-i18next";
import { LegalPage } from "~/components/legal-page";
import { getI18n, type Language } from "~/i18n/config";
import { SITE_NAME } from "~/lib/seo";
import type { Route } from "./+types/syarat";

/** Terms of use (spec 08). A draft until legal review: noindex and out of the sitemap. */
export function meta({ matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: `${t("terms.metaTitle")} | ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export default function Terms() {
  const { t } = useTranslation();
  return (
    <LegalPage
      title={t("terms.title")}
      lead={t("terms.lead")}
      sections={t("terms.sections", { returnObjects: true })}
      seeAlso={{ to: "/privasi", label: t("terms.seeAlso") }}
    />
  );
}
