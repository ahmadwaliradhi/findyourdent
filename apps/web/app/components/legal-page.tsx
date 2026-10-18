import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonVariants } from "~/components/ui/button";
import { BUSINESS_EMAIL } from "~/lib/seo";
import { cn } from "~/lib/utils";

/** A paragraph, a bulleted list, or a boxed callout (the Terms emergency note). */
type LegalBlock = string | readonly string[] | { readonly box: string };
export type LegalSection = { readonly title: string; readonly blocks: readonly LegalBlock[] };

const MARKUP = /<b>(.*?)<\/b>|<code>(.*?)<\/code>|<email\/>/g;

/** Renders the few inline tags the legal copy uses: <b>, <code> and <email/> (the business mailto link). */
export function LegalText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKUP)) {
    parts.push(text.slice(last, match.index));
    const [, bold, code] = match;
    const key = match.index;
    if (bold !== undefined)
      parts.push(
        <b key={key} className="font-semibold">
          {bold}
        </b>,
      );
    else if (code !== undefined)
      parts.push(
        <code key={key} className="rounded-sm bg-muted px-1.5 text-sm">
          {code}
        </code>,
      );
    else
      parts.push(
        <a
          key={key}
          href={`mailto:${BUSINESS_EMAIL}`}
          className="font-medium text-primary underline underline-offset-4"
        >
          {BUSINESS_EMAIL}
        </a>,
      );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string")
    return (
      <p>
        <LegalText text={block} />
      </p>
    );
  if ("box" in block)
    return (
      <div className="rounded-md bg-muted p-4 text-sm leading-5">
        <LegalText text={block.box} />
      </div>
    );
  return (
    <ul className="flex list-disc flex-col gap-2 pl-[22px]">
      {block.map((item) => (
        <li key={item}>
          <LegalText text={item} />
        </li>
      ))}
    </ul>
  );
}

function Contents({ sections }: { sections: readonly LegalSection[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {sections.map((section, i) => (
        <li key={section.title}>
          <a
            href={`#s${i + 1}`}
            className="flex min-h-touch items-center rounded-md px-2.5 text-sm text-foreground no-underline hover:bg-background hover:text-primary"
          >
            {i + 1}. {section.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * Privacy and Terms (spec 08): effective and updated dates, a contents list (side column on
 * desktop, collapsed on phones) and numbered sections.
 */
export function LegalPage({
  title,
  lead,
  sections,
  seeAlso,
}: {
  title: string;
  lead: string;
  sections: readonly LegalSection[];
  seeAlso: { to: string; label: string };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-[760px] flex-col gap-4">
        <h1 className="text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-4xl desktop:leading-[42px]">
          {title}
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground">{lead}</p>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>{t("legal.effective")}</span>
          <span>{t("legal.updated")}</span>
        </p>
      </header>
      <div className="grid grid-cols-1 gap-10 desktop:grid-cols-[280px_minmax(0,1fr)] desktop:items-start">
        <aside>
          <nav
            aria-labelledby="toc-title"
            className="sticky top-6 hidden flex-col gap-2 rounded-lg border bg-card p-5 desktop:flex"
          >
            <h2 id="toc-title" className="text-xs font-bold tracking-[.08em] text-muted-foreground uppercase">
              {t("legal.contents")}
            </h2>
            <Contents sections={sections} />
          </nav>
          <details className="rounded-lg border bg-card px-5 py-1 desktop:hidden">
            <summary className="flex min-h-touch cursor-pointer items-center font-semibold">
              {t("legal.contents")}
            </summary>
            <div className="pb-3">
              <Contents sections={sections} />
            </div>
          </details>
        </aside>
        <article className="flex max-w-[72ch] flex-col gap-8">
          {sections.map((section, i) => (
            <section
              key={section.title}
              id={`s${i + 1}`}
              aria-labelledby={`s${i + 1}-title`}
              className="flex scroll-mt-6 flex-col gap-3 leading-[26px]"
            >
              <h2 id={`s${i + 1}-title`} className="text-lg leading-6 font-[650]">
                {i + 1}. {section.title}
              </h2>
              {section.blocks.map((block) => (
                <Block key={typeof block === "string" ? block : JSON.stringify(block)} block={block} />
              ))}
            </section>
          ))}
          <div className="mt-4 grid grid-cols-1 items-center gap-5 rounded-xl bg-secondary p-7 text-secondary-foreground desktop:grid-cols-[minmax(0,1fr)_auto] desktop:p-10">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg leading-6 font-[650]">{t("legal.questions")}</h2>
              <p>
                <LegalText text={t("legal.emailUs")} />
              </p>
            </div>
            <Link to={seeAlso.to} className={cn(buttonVariants({ variant: "outline" }), "whitespace-normal")}>
              {seeAlso.label}
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
