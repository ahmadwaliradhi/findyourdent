import { Check, CircleDashed, Clock, EyeOff, type LucideIcon, Mail, Scale, Star, Trash2, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FeatureList, infoH2, infoLead } from "~/components/info-page";
import { buttonVariants } from "~/components/ui/button";
import { getI18n, type Language } from "~/i18n/config";
import { MIN_PROVEN_TESTIMONIES } from "~/lib/scores";
import { BUSINESS_EMAIL, openGraphMeta, SITE_NAME } from "~/lib/seo";
import type { Route } from "./+types/verifikasi-testimoni";

/**
 * "Cara kami memverifikasi testimoni" (spec 09, ADR-0011): why only Proven Testimonies count,
 * how a Proof of Visit is checked and kept, and the Testimony policy. Indexable and in the
 * sitemap. It never states a detection threshold.
 */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { url: `${url.origin}${url.pathname}` };
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const title = `${t("verification.metaTitle")} | ${SITE_NAME}`;
  const description = t("verification.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    ...(loaderData?.url ? openGraphMeta({ title, description, url: loaderData.url }) : []),
  ];
}

const COUNT_ICONS: LucideIcon[] = [Check, CircleDashed, Star, Scale];
const KEEP_ICONS: LucideIcon[] = [EyeOff, Clock, UserX, Trash2];

/**
 * A numbered list whose numbers come from a CSS counter, so screen readers hear the list's own
 * order and the page text carries no step numbers (the API test reads every number on the page).
 */
function NumberedList({ items }: { items: readonly string[] }) {
  return (
    <ol className="flex flex-col gap-4 [counter-reset:step]">
      {items.map((item) => (
        <li
          key={item}
          className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 [counter-increment:step] before:flex before:size-9 before:items-center before:justify-center before:rounded-full before:bg-secondary before:font-bold before:text-secondary-foreground before:content-[counter(step)]"
        >
          <p className="pt-1.5 text-[17px] leading-[26px]">{item}</p>
        </li>
      ))}
    </ol>
  );
}

export default function TestimonyVerification() {
  const { t } = useTranslation();
  const count = t("verification.count", { returnObjects: true, min: MIN_PROVEN_TESTIMONIES });
  const steps = t("verification.checkSteps", { returnObjects: true });
  const keep = t("verification.keep", { returnObjects: true });
  const policy = t("verification.policy", { returnObjects: true });
  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col gap-4 pt-2 desktop:pt-8">
        <span className="text-xs font-bold tracking-[.08em] text-muted-foreground uppercase">
          {t("verification.eyebrow")}
        </span>
        <h1 className="max-w-[20ch] text-[34px] leading-[38px] font-bold tracking-[-.02em] desktop:text-[52px] desktop:leading-[56px]">
          {t("verification.title")}
        </h1>
        <p className={infoLead}>{t("verification.lead")}</p>
      </section>

      <section aria-labelledby="count-title" className="flex flex-col gap-6">
        <h2 id="count-title" className={infoH2}>
          {t("verification.countTitle")}
        </h2>
        <FeatureList items={count} icons={COUNT_ICONS} />
      </section>

      <section
        aria-labelledby="check-title"
        className="flex flex-col gap-7 rounded-lg border bg-card p-6 shadow-sm desktop:p-8"
      >
        <div className="flex flex-col gap-2">
          <h2 id="check-title" className={infoH2}>
            {t("verification.checkTitle")}
          </h2>
          <p className={infoLead}>{t("verification.checkLead")}</p>
        </div>
        <NumberedList items={steps} />
      </section>

      <section aria-labelledby="keep-title" className="flex flex-col gap-6">
        <h2 id="keep-title" className={infoH2}>
          {t("verification.keepTitle")}
        </h2>
        <FeatureList items={keep} icons={KEEP_ICONS} />
      </section>

      <section
        aria-labelledby="policy-title"
        className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] desktop:gap-10"
      >
        <div className="flex flex-col gap-2">
          <h2 id="policy-title" className={infoH2}>
            {t("verification.policyTitle")}
          </h2>
          <p className={infoLead}>{t("verification.policyLead")}</p>
        </div>
        <NumberedList items={policy} />
      </section>

      <section
        aria-labelledby="report-title"
        className="grid grid-cols-1 items-center gap-5 rounded-xl bg-secondary p-7 text-secondary-foreground desktop:grid-cols-[minmax(0,1fr)_auto] desktop:p-10"
      >
        <div className="flex flex-col gap-2">
          <h2 id="report-title" className={infoH2}>
            {t("verification.reportTitle")}
          </h2>
          <p>{t("verification.reportBody")}</p>
          <a
            href={`mailto:${BUSINESS_EMAIL}`}
            className="inline-flex min-h-touch items-center text-[22px] leading-7 font-bold break-all"
          >
            {BUSINESS_EMAIL}
          </a>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={`mailto:${BUSINESS_EMAIL}`} className={buttonVariants({ size: "lg" })}>
            <Mail aria-hidden="true" />
            {t("about.sendEmail")}
          </a>
          <Link to="/ceritakan" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {t("nav.share")}
          </Link>
        </div>
      </section>
    </div>
  );
}
