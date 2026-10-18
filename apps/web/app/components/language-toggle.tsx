import { Globe } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Form, useLocation, useNavigation } from "react-router";
import { LANGUAGES, type Language } from "~/i18n/config";
import { carryEntryToNext, dropCarry } from "~/lib/entry-memory";
import { cn } from "~/lib/utils";

const optionClass =
  "inline-flex min-h-touch min-w-touch items-center justify-center rounded-full px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none";

/**
 * Visible on every page (rendered by the site header): both languages, the current one marked.
 * Only the other language submits. Posts to /language, so it works without JavaScript.
 * The redirect lands as a new history entry, which takes over what this one showed. It is
 * pushed, not replaced: the router would replace a redirect back to the same URL, and Back
 * would then skip the entry the Patient switched from.
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
    <Form
      method="post"
      action="/language"
      replace={false}
      preventScrollReset
      onSubmit={() => carryEntryToNext(location.key)}
    >
      <input type="hidden" name="lang" value={other} />
      <input type="hidden" name="redirectTo" value={`${location.pathname}${location.search}`} />
      <fieldset
        aria-label={t("language.group")}
        className="inline-flex items-center gap-0.5 rounded-full border border-border-strong bg-background py-0.5 pr-0.5 pl-2.5 text-muted-foreground"
      >
        <Globe aria-hidden="true" className="mr-1 size-4 shrink-0" />
        {LANGUAGES.map((code) => {
          const label = (
            <>
              <span className="sr-only desktop:not-sr-only">{t(`language.${code}`)}</span>
              <span aria-hidden="true" className="desktop:hidden">
                {code.toUpperCase()}
              </span>
            </>
          );
          return code === language ? (
            <span
              key={code}
              lang={code}
              aria-current="true"
              className={cn(optionClass, "bg-primary text-primary-foreground")}
            >
              {label}
            </span>
          ) : (
            <button
              key={code}
              type="submit"
              lang={code}
              aria-label={t("language.switchToLabel")}
              className={cn(optionClass, "cursor-pointer text-foreground hover:bg-muted")}
            >
              {label}
            </button>
          );
        })}
      </fieldset>
    </Form>
  );
}
