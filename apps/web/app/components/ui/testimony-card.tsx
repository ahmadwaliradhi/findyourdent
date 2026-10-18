import { Star } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";

interface Rating {
  label: string;
  score: number;
  /** Spoken in place of "n/5", e.g. "4 dari 5". */
  spokenScore: string;
}

interface Fact {
  label: string;
  value: string;
}

/**
 * One Patient Testimony: Provider link, meta, three aspect ratings, excerpt, procedure and
 * price, byline. See docs/design/design-system/components/TestimonyCard.
 */
function TestimonyCard({
  id,
  providerName,
  href,
  meta,
  proofLabel,
  ratings,
  ratingsLabel,
  excerpt,
  facts,
  byline,
  readMore,
  className,
}: {
  id: string;
  providerName: string;
  href: string;
  /** Provider type and Region. */
  meta: string;
  /** Whether the visit is proven ("Kunjungan terbukti" or "Belum terbukti"), beside the Provider name. */
  proofLabel?: ReactNode;
  ratings: Rating[];
  ratingsLabel: string;
  excerpt: string;
  /** Procedure and price, already formatted. */
  facts: Fact[];
  byline: string;
  readMore: { href: string; label: string; srSuffix?: string };
  className?: string;
}) {
  return (
    <article
      aria-labelledby={id}
      className={cn("flex flex-col gap-3 rounded-lg border bg-card p-5 text-card-foreground shadow-sm", className)}
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={id} className="text-xl leading-[26px] font-[650]">
            <Link to={href} className="inline-flex min-h-touch items-center underline-offset-4 hover:underline">
              {providerName}
            </Link>
          </h3>
          {proofLabel}
        </div>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </header>

      <AspectRatings ratings={ratings} label={ratingsLabel} />

      <p className="whitespace-pre-line">{excerpt}</p>

      <FactList facts={facts} />

      <footer className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{byline}</span>
        <Link
          to={readMore.href}
          className="inline-flex min-h-touch items-center font-semibold text-primary underline underline-offset-4"
        >
          {readMore.label}
          {readMore.srSuffix && <span className="sr-only">: {readMore.srSuffix}</span>}
        </Link>
      </footer>
    </article>
  );
}

/** The three aspect scores, each with a star and a spoken "n dari 5". */
function AspectRatings({ ratings, label }: { ratings: Rating[]; label: string }) {
  return (
    <dl className="grid grid-cols-3 gap-2" aria-label={label}>
      {ratings.map((rating) => (
        <div key={rating.label} className="flex flex-col gap-0.5 rounded-md bg-secondary p-2">
          <dt className="text-xs font-medium text-secondary-foreground">{rating.label}</dt>
          <dd className="flex items-center gap-1 text-base leading-5 font-bold tabular-nums">
            <Star aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 fill-star text-star" />
            <span aria-hidden="true">{rating.score}/5</span>
            <span className="sr-only">{rating.spokenScore}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Procedure and price, label beside value. Renders nothing without facts. */
function FactList({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
      {facts.map((fact) => (
        <Fragment key={fact.label}>
          <dt className="text-muted-foreground">{fact.label}:</dt>
          <dd className="font-semibold tabular-nums">{fact.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export { AspectRatings, FactList, TestimonyCard };
