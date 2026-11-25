import { useTranslation } from "react-i18next";
import { LegalPage } from "~/components/legal-page";
import { getI18n, type Language } from "~/i18n/config";
import { openGraphMeta, SITE_NAME } from "~/lib/seo";
import type { Route } from "./+types/bpjs";

/**
 * 'BPJS Kesehatan dan perawatan gigi': what JKN covers for dental care at an FKTP and by
 * referral, why a BPJS card does not work at any clinic, and how to read "Cara bayar pasien"
 * (spec 07; docs/research/facts-2026-10-16.md §1, §2, §6). Indexable and in the sitemap.
 */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { url: `${url.origin}${url.pathname}` };
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const title = `${t("bpjsPage.metaTitle")} | ${SITE_NAME}`;
  const description = t("bpjsPage.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    ...(loaderData?.url ? openGraphMeta({ title, description, url: loaderData.url }) : []),
  ];
}

export default function BpjsPage() {
  const { t } = useTranslation();
  return (
    <LegalPage
      title={t("bpjsPage.title")}
      lead={t("bpjsPage.lead")}
      dates={{ effective: t("bpjsPage.effective"), updated: t("bpjsPage.updated") }}
      sections={t("bpjsPage.sections", { returnObjects: true })}
      seeAlso={{ to: "/", label: t("bpjsPage.seeAlso") }}
    />
  );
}
