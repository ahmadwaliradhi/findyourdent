// The folded "Filter" section over a listing: native <details>, so it opens and closes before hydration.
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";

export function FilterSection(props: {
  /** Starts open, so applied filters stay in view; folded otherwise, so the listing comes first. */
  open: boolean;
  children: React.ReactNode;
}) {
  const { open, children } = props;
  const { t } = useTranslation();
  return (
    <details className="group rounded-lg border bg-card px-5 py-3" open={open}>
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
        {t("filters.title")}
        <ChevronDown aria-hidden className="size-5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="pt-4 pb-2">{children}</div>
    </details>
  );
}
