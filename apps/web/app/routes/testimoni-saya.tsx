import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, redirect } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { getI18n, type Language } from "~/i18n/config";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatVisitMonth } from "~/lib/format";
import { testimonyPath } from "~/lib/paths";
import { loadMyTestimonies, type MyTestimony } from "~/server/testimonies.server";
import { readSession } from "../../server/auth.ts";
import type { Route } from "./+types/testimoni-saya";

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: t("myTestimonies.metaTitle") }, { name: "robots", content: "noindex" }];
}

/** 'Testimoni saya': the signed-in author's own Testimonies, in every state but deleted. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await readSession(context.auth, request.headers.get("cookie"));
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/signin?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return { items: context.firestore ? await loadMyTestimonies(context.firestore, user.uid) : [] };
}

export default function MyTestimonies({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState(loaderData.items);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="my-testimonies-title">
      <h1 id="my-testimonies-title" className="text-2xl font-bold">
        {t("myTestimonies.title")}
      </h1>
      <p className="text-muted-foreground">{t("myTestimonies.intro")}</p>
      <p role="status" className="text-sm">
        {notice}
      </p>
      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t("myTestimonies.empty")}</p>
          <Button asChild>
            <Link to="/ceritakan">{t("myTestimonies.writeCta")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <MyTestimonyCard
                item={item}
                onDeleted={() => {
                  setItems((list) => list.filter((other) => other.id !== item.id));
                  setNotice(t("myTestimonies.deleted"));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyTestimonyCard({ item, onDeleted }: { item: MyTestimony; onDeleted: () => void }) {
  const { t, i18n } = useTranslation();
  const language: Language = i18n.language === "en" ? "en" : "id";
  const firebase = useFirebaseConfig();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const headingId = `testimony-${item.id}`;

  const remove = async () => {
    setDeleting(true);
    setFailed(false);
    try {
      const token = await getAppCheckToken(firebase);
      const response = await fetch(`/api/testimonies/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: token ? { [APP_CHECK_HEADER]: token } : {},
      });
      if (response.ok) return onDeleted();
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="flex flex-col gap-2 rounded-lg border p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {item.providerName}
        </h2>
        <Badge variant={item.status === "published" ? "default" : "secondary"}>
          {t(`myTestimonies.status.${item.status === "deleted" ? "removed" : item.status}`)}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("myTestimonies.visit", { month: formatVisitMonth(item.visitMonth, language) })}
      </p>
      {item.pendingStatus ? (
        <p className="text-sm">{t(`myTestimonies.pendingRevision.${item.pendingStatus}`)}</p>
      ) : null}
      {item.adminReason &&
      (item.status === "rejected" ||
        item.status === "removed" ||
        item.status === "needsAuthorFix" ||
        item.pendingStatus === "needsAuthorFix") ? (
        <p className="text-sm">{t("myTestimonies.reason", { reason: item.adminReason })}</p>
      ) : null}
      <p className="line-clamp-4 whitespace-pre-line">{item.text}</p>
      {item.reply ? (
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">{t("myTestimonies.reply")}</p>
          <p className="whitespace-pre-line">{item.reply}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {item.status === "published" && item.listed ? (
          <Button asChild variant="outline" size="sm">
            <Link to={testimonyPath(item.placeId, item.id)}>{t("myTestimonies.view")}</Link>
          </Button>
        ) : null}
        {item.editable ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/testimoni-saya/${encodeURIComponent(item.id)}/ubah`}>{t("myTestimonies.edit")}</Link>
          </Button>
        ) : null}
        {confirming ? null : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            {t("myTestimonies.delete")}
          </Button>
        )}
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`${headingId}-confirm`}
          aria-describedby={`${headingId}-confirm-body`}
          className="flex flex-col gap-2 rounded-md border border-destructive p-3"
        >
          <p id={`${headingId}-confirm`} className="font-medium">
            {t("myTestimonies.confirmTitle")}
          </p>
          <p id={`${headingId}-confirm-body`} className="text-sm">
            {t("myTestimonies.confirmBody")}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={deleting} onClick={remove}>
              {deleting ? t("myTestimonies.deleting") : t("myTestimonies.confirmDelete")}
            </Button>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              {t("myTestimonies.cancel")}
            </Button>
          </div>
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t("myTestimonies.deleteFailed")}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
