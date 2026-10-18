import { useTranslation } from "react-i18next";
import { redirect } from "react-router";
import { TestimonyForm, TestimonyTips } from "~/components/testimony-form";
import { getI18n } from "~/i18n/config";
import { loadTestimonyForEdit } from "~/server/testimonies.server";
import { readSession } from "../../server/auth.ts";
import type { Route } from "./+types/testimoni-saya.$testimonyId.ubah";

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: t("testimonyForm.editTitle") }, { name: "robots", content: "noindex" }];
}

/** Edit one of the author's own Testimonies. Hidden or removed ones go back to the list. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const user = await readSession(context.auth, request.headers.get("cookie"));
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/signin?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (!context.firestore) throw new Response(null, { status: 404 });
  const editable = await loadTestimonyForEdit(context.firestore, user.uid, params.testimonyId);
  if (!editable.ok) {
    if (editable.status === 409) throw redirect("/testimoni-saya");
    throw new Response(null, { status: editable.status });
  }
  return editable;
}

export default function EditTestimony({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 items-start gap-6 desktop:grid-cols-[minmax(0,1fr)_360px] desktop:gap-10">
      <section className="flex min-w-0 flex-col gap-6" aria-labelledby="edit-testimony-title">
        <h1
          id="edit-testimony-title"
          className="text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-[36px] desktop:leading-[42px]"
        >
          {t("testimonyForm.editTitle")}
        </h1>
        <TestimonyForm
          mode="edit"
          testimonyId={loaderData.testimonyId}
          provider={loaderData.provider}
          initial={loaderData.initial}
        />
      </section>
      <TestimonyTips />
    </div>
  );
}
