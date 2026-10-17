import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Form, useLocation, useNavigation } from "react-router";
import type { Language } from "~/i18n/config";
import { carryEntryToNext, dropCarry } from "~/lib/entry-memory";
import { Button } from "./ui/button";

/**
 * Visible on every page (rendered by the root layout). Posts to /language, so it works without JavaScript.
 * The redirect lands as a new history entry, which takes over what this one showed.
 */
export function LanguageToggle({ language }: { language: Language }) {
  const { t } = useTranslation();
  const location = useLocation();
  const other: Language = language === "id" ? "en" : "id";
  // Runs after the redirected page has rendered (and taken the carry), or after a failed post.
  const { state } = useNavigation();
  useEffect(() => {
    if (state === "idle") dropCarry();
  }, [state]);
  return (
    <Form method="post" action="/language" preventScrollReset onSubmit={() => carryEntryToNext(location.key)}>
      <input type="hidden" name="lang" value={other} />
      <input type="hidden" name="redirectTo" value={`${location.pathname}${location.search}`} />
      <Button type="submit" variant="outline" size="sm" lang={other} aria-label={t("language.switchToLabel")}>
        {t("language.switchTo")}
      </Button>
    </Form>
  );
}
