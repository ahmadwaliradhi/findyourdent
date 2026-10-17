import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button } from "~/components/ui/button";
import { getI18n } from "~/i18n/config";
import type { Route } from "./+types/admin";

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: t("admin.title") }, { name: "robots", content: "noindex" }];
}

/**
 * Admin home. Only allowlisted accounts get here: the Express gate (server/auth.ts)
 * refuses everyone else on every /admin URL before React Router runs.
 */
export function loader({ context }: Route.LoaderArgs) {
  if (!context.admin) throw new Response(null, { status: 403 });
  return { email: context.admin.email };
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4" aria-labelledby="admin-title">
      <h1 id="admin-title" className="text-2xl font-bold">
        {t("admin.title")}
      </h1>
      <p className="text-muted-foreground">{t("admin.signedInAs", { email: loaderData.email })}</p>
      <p>{t("admin.empty")}</p>
      <Form method="post" action="/auth/signout">
        <Button type="submit" variant="outline">
          {t("admin.signOut")}
        </Button>
      </Form>
    </section>
  );
}
