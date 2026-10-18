import type { TestimonyStatus } from "@findyourdent/contracts/firestore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, redirect } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { FieldError } from "~/components/ui/field";
import { getI18n, type Language } from "~/i18n/config";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatVisitMonth } from "~/lib/format";
import { testimonyPath } from "~/lib/paths";
import { testimonyStatusBadge } from "~/lib/testimony-status";
import { cn } from "~/lib/utils";
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
    <div className="grid grid-cols-1 items-start gap-6 desktop:grid-cols-[minmax(0,1fr)_360px] desktop:gap-10">
      <section className="flex flex-col gap-6" aria-labelledby="my-testimonies-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h1
              id="my-testimonies-title"
              className="text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-4xl desktop:leading-[42px]"
            >
              {t("myTestimonies.title")}
            </h1>
            <p className="max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground">{t("myTestimonies.intro")}</p>
          </div>
          <Link to="/ceritakan" className={cn(buttonVariants(), "hidden desktop:inline-flex")}>
            {t("myTestimonies.writeCta")}
          </Link>
        </div>
        {/* Always rendered so the live region announces a notice; while empty it cancels the gap above. */}
        <p role="status" className="text-sm empty:-mt-6">
          {notice}
        </p>
        {items.length === 0 ? (
          <p>{t("myTestimonies.empty")}</p>
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
        <Link to="/ceritakan" className={cn(buttonVariants({ block: true }), "desktop:hidden")}>
          {t("myTestimonies.writeCta")}
        </Link>
      </section>
      <StatusLegend />
    </div>
  );
}

/** One status Badge: the word with its icon, so the status never rides on color alone. */
function StatusBadge({ status }: { status: TestimonyStatus }) {
  const { t } = useTranslation();
  return (
    <Badge {...testimonyStatusBadge(status)} className="whitespace-normal">
      {t(`myTestimonies.status.${status === "deleted" ? "removed" : status}`)}
    </Badge>
  );
}

/** Desktop aside explaining the statuses an author meets most. */
function StatusLegend() {
  const { t } = useTranslation();
  const statuses = ["published", "needsAuthorFix", "held"] as const;
  return (
    <aside className="hidden desktop:sticky desktop:top-6 desktop:block" aria-labelledby="status-legend-title">
      <Card variant="flat">
        <h2 id="status-legend-title" className="text-base leading-[22px] font-[650]">
          {t("myTestimonies.legend.title")}
        </h2>
        <ul className="flex flex-col gap-3 text-sm">
          {statuses.map((status) => (
            <li key={status} className="flex flex-col gap-1">
              <StatusBadge status={status} />
              <span className="text-muted-foreground">{t(`myTestimonies.legend.${status}`)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
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
  const needsFix = item.status === "needsAuthorFix";
  const showReason =
    item.adminReason &&
    (item.status === "rejected" ||
      item.status === "removed" ||
      item.status === "needsAuthorFix" ||
      item.pendingStatus === "needsAuthorFix");
  const editPath = `/testimoni-saya/${encodeURIComponent(item.id)}/ubah`;

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
    <Card labelledBy={headingId} className={cn(needsFix && "border-warning-line")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg leading-6 font-[650]">
            {item.providerName}
          </h2>
          <span className="text-sm text-muted-foreground">
            {t("myTestimonies.visit", { month: formatVisitMonth(item.visitMonth, language) })}
          </span>
        </div>
        <StatusBadge status={item.status} />
      </div>
      {item.status === "held" || item.status === "hidden" ? (
        <p className="text-sm text-muted-foreground">{t(`myTestimonies.statusHint.${item.status}`)}</p>
      ) : null}
      {item.pendingStatus ? (
        <p className="rounded-md border border-info-line bg-info-soft px-4 py-3 text-sm">
          {t(`myTestimonies.pendingRevision.${item.pendingStatus}`)}
        </p>
      ) : null}
      {showReason ? (
        <div className="flex flex-col gap-1 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm">
          <span className="font-semibold text-warning">{t("myTestimonies.reasonTitle")}</span>
          <span>{item.adminReason}</span>
        </div>
      ) : null}
      <p className="line-clamp-4 whitespace-pre-line">{item.text}</p>
      {item.reply ? (
        <div className="flex flex-col gap-1 rounded-md border bg-muted px-4 py-3 text-sm">
          <span className="font-semibold">{t("myTestimonies.reply")}</span>
          <p className="whitespace-pre-line">{item.reply}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {item.status === "published" && item.listed ? (
          <Button asChild variant="link" size="sm">
            <Link to={testimonyPath(item.placeId, item.id)}>{t("myTestimonies.view")}</Link>
          </Button>
        ) : null}
        {item.editable ? (
          needsFix ? (
            <Button asChild size="sm">
              <Link to={editPath}>{t("myTestimonies.fix")}</Link>
            </Button>
          ) : (
            <Button asChild variant="link" size="sm">
              <Link to={editPath}>{t("myTestimonies.edit")}</Link>
            </Button>
          )
        ) : null}
        {confirming ? null : (
          <Button variant="link" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
            {t("myTestimonies.delete")}
          </Button>
        )}
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`${headingId}-confirm`}
          aria-describedby={`${headingId}-confirm-body`}
          className="flex flex-col gap-2 rounded-md border border-destructive-line bg-destructive-soft px-4 py-3"
        >
          <p id={`${headingId}-confirm`} className="font-semibold">
            {t("myTestimonies.confirmTitle")}
          </p>
          <p id={`${headingId}-confirm-body`} className="text-sm">
            {t("myTestimonies.confirmBody")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="sm" loading={deleting} onClick={remove}>
              {deleting ? t("myTestimonies.deleting") : t("myTestimonies.confirmDelete")}
            </Button>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              {t("myTestimonies.cancel")}
            </Button>
          </div>
          {failed ? <FieldError role="alert">{t("myTestimonies.deleteFailed")}</FieldError> : null}
        </div>
      ) : null}
    </Card>
  );
}
