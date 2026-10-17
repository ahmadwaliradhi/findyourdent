import { useTranslation } from "react-i18next";
import { TestimonyForm } from "~/components/testimony-form";
import { getI18n, type Language } from "~/i18n/config";
import { SITE_NAME } from "~/lib/seo";
import { isPlaceId } from "~/server/provider.server";
import type { Route } from "./+types/ceritakan";

/**
 * 'Ceritakan pengalamanmu' (spec 03): the Testimony posting form. From a Provider page
 * the place comes in as ?placeId= and is picked already. Not indexed: it is a form.
 */
export function loader({ request }: Route.LoaderArgs) {
  const placeId = new URL(request.url).searchParams.get("placeId") ?? undefined;
  return { placeId: isPlaceId(placeId) ? placeId : null };
}

export function meta({ matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [
    { title: `${t("testimonyForm.metaTitle")} | ${SITE_NAME}` },
    { name: "description", content: t("testimonyForm.metaDescription") },
    { name: "robots", content: "noindex" },
  ];
}

export default function TellYourStory({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { placeId } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t("testimonyForm.title")}</h1>
        <p className="text-muted-foreground">{t("testimonyForm.intro")}</p>
      </header>
      {/* Keyed on the place, so following another Provider page's link starts fresh. */}
      <TestimonyForm key={placeId ?? ""} mode="create" initial={placeId ? { placeId } : undefined} />
    </div>
  );
}
