import { ArrowLeft } from "lucide-react";
import type * as React from "react";
import { Link } from "react-router";

/** The Claim and Price List pages' head: a back link, the place's name, the page title and a lead line. */
export function OwnerPageHeader({
  backTo,
  backLabel,
  placeName,
  title,
  lead,
}: {
  backTo: string;
  backLabel: string;
  placeName: string | null;
  title: string;
  lead?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <Link
        to={backTo}
        className="inline-flex min-h-touch w-fit items-center gap-2 font-semibold text-foreground no-underline"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0" />
        {backLabel}
      </Link>
      {placeName && (
        <p className="text-xs leading-4 font-bold tracking-[.08em] text-muted-foreground uppercase">{placeName}</p>
      )}
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-.015em]">{title}</h1>
      {lead && <p className="max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground">{lead}</p>}
    </header>
  );
}
