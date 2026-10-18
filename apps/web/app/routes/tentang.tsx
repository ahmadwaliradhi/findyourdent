import {
  ArrowRight,
  BookOpen,
  Clock,
  Globe,
  Lock,
  type LucideIcon,
  Mail,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  OctagonAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { getI18n, type Language } from "~/i18n/config";
import { BUSINESS_EMAIL, openGraphMeta, SITE_NAME } from "~/lib/seo";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/tentang";

/** About (spec 08): who runs FindYourDent and why. Indexable and in the sitemap. */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { url: `${url.origin}${url.pathname}` };
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  const title = `${t("about.metaTitle")} | ${SITE_NAME}`;
  const description = t("about.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    ...(loaderData?.url ? openGraphMeta({ title, description, url: loaderData.url }) : []),
  ];
}

const WHAT_ICONS: LucideIcon[] = [MessageCircle, OctagonAlert, MapPin, Users];
const SAFE_ICONS: LucideIcon[] = [ShieldCheck, BookOpen, Lock, Users];
const ROADMAP: { icon: LucideIcon; badge: ComponentProps<typeof Badge> }[] = [
  { icon: MapPin, badge: { variant: "success" } },
  { icon: MapIcon, badge: { variant: "brand", icon: ArrowRight } },
  { icon: Globe, badge: { variant: "neutral", icon: Clock } },
];

const h2 = "text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-4xl desktop:leading-[42px]";
const lead = "max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground";

function FeatureIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
      <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
    </span>
  );
}

function Features({ items, icons }: { items: readonly { title: string; body: string }[]; icons: LucideIcon[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-10 gap-y-7 desktop:grid-cols-2">
      {items.map((item, i) => (
        <li key={item.title} className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3.5">
          <FeatureIcon icon={icons[i] ?? MessageCircle} />
          <div className="flex flex-col gap-1">
            <h3 className="leading-[22px] font-[650]">{item.title}</h3>
            <p className="text-muted-foreground">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Drawn, not an emoji: Windows renders the flag emoji as the letters "ID". */
function IndonesianFlag({ label }: { label: string }) {
  return (
    <svg
      viewBox="0 0 3 2"
      role="img"
      aria-label={label}
      className="h-3.5 w-[21px] shrink-0 rounded-[2px] ring-1 ring-border"
    >
      <rect width="3" height="1" fill="#ce1126" />
      <rect y="1" width="3" height="1" fill="#fff" />
    </svg>
  );
}

/** The mockup's soft brand shapes behind the hero, desktop only. Token fills, never hex. */
function HeroShapes() {
  return (
    <svg
      viewBox="0 0 520 520"
      aria-hidden="true"
      className="pointer-events-none absolute -top-10 -right-10 hidden size-[520px] desktop:block"
    >
      <path d="M300 120a60 60 0 0 1 60-60a60 60 0 0 1 60 60v60h-60a60 60 0 0 1-60-60z" className="fill-secondary" />
      <circle cx="460" cy="250" r="44" className="fill-secondary" />
      <path
        d="M380 330a50 50 0 0 1 50-50a50 50 0 0 1 50 50v50h-50a50 50 0 0 1-50-50z"
        className="fill-primary opacity-12"
      />
    </svg>
  );
}

export default function About() {
  const { t } = useTranslation();
  const what = t("about.what", { returnObjects: true });
  const safe = t("about.safe", { returnObjects: true });
  const roadmap = t("about.roadmap", { returnObjects: true });
  const principles = t("about.principles", { returnObjects: true });
  return (
    <div className="flex flex-col gap-16">
      <section className="relative flex flex-col gap-4 pt-2 desktop:pt-8">
        <HeroShapes />
        <span className="relative text-xs font-bold tracking-[.08em] text-muted-foreground uppercase">
          {t("about.eyebrow")}
        </span>
        <h1 className="relative max-w-[18ch] text-[34px] leading-[38px] font-bold tracking-[-.02em] desktop:text-[52px] desktop:leading-[56px]">
          {t("about.title")}
        </h1>
        <p className={cn(lead, "relative")}>{t("about.lead")}</p>
        <p className="relative flex items-center gap-2 text-sm text-muted-foreground">
          {t("about.builtFor")}
          <IndonesianFlag label={t("about.flag")} />
        </p>
      </section>

      <section aria-labelledby="what-title" className="flex flex-col gap-6">
        <h2 id="what-title" className={h2}>
          {t("about.whatTitle")}
        </h2>
        <Features items={what} icons={WHAT_ICONS} />
      </section>

      <section
        aria-labelledby="safe-title"
        className="flex flex-col gap-7 rounded-lg border bg-card p-6 shadow-sm desktop:p-8"
      >
        <div className="flex flex-col gap-2">
          <h2 id="safe-title" className={h2}>
            {t("about.safeTitle")}
          </h2>
          <p className={lead}>{t("about.safeLead")}</p>
        </div>
        <Features items={safe} icons={SAFE_ICONS} />
      </section>

      <section aria-labelledby="go-title" className="flex flex-col gap-6">
        <div className="flex max-w-[760px] flex-col gap-2">
          <h2 id="go-title" className={h2}>
            {t("about.goTitle")}
          </h2>
          <p className={lead}>{t("about.goLead")}</p>
        </div>
        <ol className="grid grid-cols-1 gap-3 desktop:grid-cols-3 desktop:gap-5">
          {roadmap.map((stage, i) => {
            const { icon, badge } = ROADMAP[i] ?? { icon: Globe, badge: { variant: "neutral" } };
            return (
              <li
                key={stage.title}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border bg-card p-5",
                  i === 0 && "border-2 border-primary",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <FeatureIcon icon={icon} />
                  <Badge {...badge}>{stage.status}</Badge>
                </div>
                <h3 className="text-lg leading-6 font-[650]">{stage.title}</h3>
                <p className="text-muted-foreground">{stage.body}</p>
              </li>
            );
          })}
        </ol>
        <p className="max-w-[72ch] text-sm text-muted-foreground">{t("about.roadmapNote")}</p>
      </section>

      <section
        aria-labelledby="principles-title"
        className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] desktop:gap-10"
      >
        <h2 id="principles-title" className={h2}>
          {t("about.principlesTitle")}
        </h2>
        <ol className="flex flex-col gap-4">
          {principles.map((principle, i) => (
            <li key={principle} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground"
              >
                {i + 1}
              </span>
              <p className="pt-1.5 text-[17px] leading-[26px]">{principle}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="contact-title"
        className="grid grid-cols-1 items-center gap-5 rounded-xl bg-secondary p-7 text-secondary-foreground desktop:grid-cols-[minmax(0,1fr)_auto] desktop:p-10"
      >
        <div className="flex flex-col gap-2">
          <h2 id="contact-title" className={h2}>
            {t("about.contactTitle")}
          </h2>
          <p>{t("about.contactBody")}</p>
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
          <Link to="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {t("about.start")}
          </Link>
        </div>
      </section>
    </div>
  );
}
