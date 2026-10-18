import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";
import type { Language } from "~/i18n/config";
import { cn } from "~/lib/utils";
import { LanguageToggle } from "./language-toggle";
import { buttonVariants } from "./ui/button";

/** Content width every page shares: 1200px, 16px gutter on phones, 40px from the desktop breakpoint. */
export const pageWrap = "mx-auto w-full max-w-[1200px] px-4 desktop:px-10";

const BUSINESS_EMAIL = "business@findyourdent.com";

/** The Testimony form with no place picked. */
const SHARE_PATH = "/ceritakan";

type NavItem = { to: string; label: string };

function useNavItems() {
  const { t } = useTranslation();
  const guidance = { to: "/", label: t("nav.guidance") };
  const directory = { to: "/direktori", label: t("nav.directory") };
  const myTestimonies = { to: "/testimoni-saya", label: t("nav.myTestimonies") };
  const share = { to: SHARE_PATH, label: t("nav.share") };
  return {
    desktop: [guidance, directory, myTestimonies],
    // On phones the pill row carries the share link too, in the mockup's order.
    pills: [guidance, directory, share, myTestimonies],
  };
}

/** Marks the current page with aria-current="page"; Panduan only on the home page itself. */
function NavItemLink({ item, className }: { item: NavItem; className: (isActive: boolean) => string }) {
  return (
    <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => className(isActive)}>
      {item.label}
    </NavLink>
  );
}

export function SiteHeader({ language }: { language: Language }) {
  const { t } = useTranslation();
  const items = useNavItems();
  return (
    <header className="border-b bg-card shadow-xs">
      <div className={cn(pageWrap, "flex min-h-16 items-center justify-between gap-4")}>
        <Link to="/" aria-label={t("nav.home")} className="inline-flex min-h-touch items-center rounded-md">
          <img src="/brand/wordmark.svg" alt="" width={160} height={32} className="h-7 w-auto desktop:h-8" />
        </Link>
        <nav aria-label={t("nav.main")} className="hidden items-center gap-1 desktop:flex">
          {items.desktop.map((item) => (
            <NavItemLink
              key={item.to}
              item={item}
              className={(isActive) =>
                cn(
                  "inline-flex min-h-touch items-center px-3 font-medium text-foreground",
                  isActive
                    ? "font-semibold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]"
                    : "rounded-md hover:bg-background",
                )
              }
            />
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to={SHARE_PATH}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hidden desktop:inline-flex")}
          >
            {t("nav.share")}
          </Link>
          <LanguageToggle language={language} />
        </div>
      </div>
      <nav
        aria-label={t("nav.main")}
        className="flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] desktop:hidden"
      >
        {items.pills.map((item) => (
          <NavItemLink
            key={item.to}
            item={item}
            className={(isActive) =>
              cn(
                "inline-flex min-h-touch flex-none items-center rounded-full px-3 text-sm font-medium text-foreground",
                isActive && "bg-secondary font-semibold text-secondary-foreground",
              )
            }
          />
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useTranslation();
  const linkClass = "inline-flex min-h-touch items-center text-muted-foreground underline underline-offset-4";
  return (
    <footer className="border-t bg-card pt-6 pb-8">
      <div
        className={cn(
          pageWrap,
          "flex flex-col gap-3 text-sm text-muted-foreground desktop:flex-row desktop:items-center desktop:justify-between",
        )}
      >
        <p>{t("footer.note")}</p>
        <nav aria-label={t("footer.links")} className="flex flex-wrap gap-x-4">
          <a href={`mailto:${BUSINESS_EMAIL}`} className={linkClass}>
            {BUSINESS_EMAIL}
          </a>
          <Link to="/direktori" className={linkClass}>
            {t("nav.directory")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
