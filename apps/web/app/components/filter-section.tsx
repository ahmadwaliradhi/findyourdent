// The folded "Filter" section over a listing: native <details>, so it opens and closes before hydration.
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

export function FilterSection(props: {
  /** Starts open, so applied filters stay in view; folded otherwise, so the listing comes first. */
  open: boolean;
  /**
   * Folds below desktop width only: from desktop up (desktop-unfolded in app.css) the <details>,
   * its summary and wrapper drop out of the box tree, so the children sit in the page grid as they are.
   */
  unfoldOnDesktop?: boolean;
  children: React.ReactNode;
}) {
  const { open, unfoldOnDesktop = false, children } = props;
  const { t } = useTranslation();
  return (
    <details
      className={cn(
        "group rounded-lg border bg-card px-5 py-3",
        unfoldOnDesktop && "desktop-unfolded:contents desktop-unfolded:details-content:contents",
      )}
      open={open}
    >
      <summary
        className={cn(
          "flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden",
          unfoldOnDesktop && "desktop-unfolded:hidden",
        )}
      >
        {t("filters.title")}
        <ChevronDown aria-hidden className="size-5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className={cn("pt-4 pb-2", unfoldOnDesktop && "flex flex-col gap-4 desktop-unfolded:contents")}>
        {children}
      </div>
    </details>
  );
}
