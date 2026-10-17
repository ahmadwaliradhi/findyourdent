import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";
import { GuidanceCard } from "~/components/guidance-result";
import { Button } from "~/components/ui/button";
import { getI18n } from "~/i18n/config";
import { readShareToken } from "~/server/share.server";
import type { Route } from "./+types/panduan.$token";

/** A shared Guidance card, rebuilt from the signed link alone. Nothing is stored or looked up. */
export function loader({ params, context }: Route.LoaderArgs) {
  const guidance = readShareToken(params.token, context.config.shareLinkSecret);
  if (!guidance) throw data(null, { status: 404 });
  return { guidance };
}

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [
    { title: `${t("shared.title")} | FindYourDent` },
    { name: "description", content: t("shared.metaDescription") },
    { name: "robots", content: "noindex" },
  ];
}

export default function SharedGuidance({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t("shared.title")}</h1>
        <p className="text-muted-foreground">{t("shared.intro")}</p>
      </div>
      <GuidanceCard guidance={loaderData.guidance} share={null} guidanceToken={params.token} />
      <Button asChild size="lg" className="w-full sm:w-auto sm:self-start">
        <Link to="/">{t("shared.cta")}</Link>
      </Button>
    </div>
  );
}
