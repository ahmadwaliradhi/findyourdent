import type * as React from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import {
  data,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { pageWrap, SiteFooter, SiteHeader } from "~/components/site-shell";
import { Button } from "~/components/ui/button";
import { DEFAULT_LANGUAGE, getI18n, type Language } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preload", href: "/fonts/Figtree-Variable.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const language = await detectLanguage(request);
  return data({ language, firebase: context.config.firebaseWeb }, { headers: { Vary: "Cookie" } });
}

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const language: Language = loaderData?.language ?? DEFAULT_LANGUAGE;
  const i18n = getI18n(language);
  const t = i18n.getFixedT(language);

  return (
    <html lang={language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b6e6a" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2"
          >
            {t("nav.skipToContent")}
          </a>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader language={language} />
            <main id="main" className={cn(pageWrap, "flex-1 py-6 desktop:py-10")}>
              {children}
            </main>
            <SiteFooter />
          </div>
        </I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="error-title">
      <h1 id="error-title" className="text-2xl font-bold">
        {notFound ? t("errors.notFoundTitle") : t("errors.title")}
      </h1>
      <p className="text-muted-foreground">{notFound ? t("errors.notFound") : t("errors.generic")}</p>
      <div className="flex flex-wrap gap-3">
        {!notFound && (
          <Button type="button" onClick={() => window.location.reload()}>
            {t("errors.retry")}
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/">{t("errors.backHome")}</Link>
        </Button>
      </div>
    </section>
  );
}
