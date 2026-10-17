import { useTranslation } from "react-i18next";
import { Form, useLocation } from "react-router";
import type { Language } from "~/i18n/config";
import { Button } from "./ui/button";

/** Visible on every page (rendered by the root layout). Posts to /language, so it works without JavaScript. */
export function LanguageToggle({ language }: { language: Language }) {
  const { t } = useTranslation();
  const location = useLocation();
  const other: Language = language === "id" ? "en" : "id";
  return (
    <Form method="post" action="/language" preventScrollReset>
      <input type="hidden" name="lang" value={other} />
      <input type="hidden" name="redirectTo" value={`${location.pathname}${location.search}`} />
      <Button type="submit" variant="outline" size="sm" lang={other} aria-label={t("language.switchToLabel")}>
        {t("language.switchTo")}
      </Button>
    </Form>
  );
}
