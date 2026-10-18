import { type LucideIcon, MessageCircle } from "lucide-react";

// Building blocks the About and Testimony verification pages share (spec 08 About layout).

/** Section heading: 28px on phones, 36px from the desktop breakpoint. */
export const infoH2 = "text-[28px] leading-[34px] font-bold tracking-[-.015em] desktop:text-4xl desktop:leading-[42px]";
/** Lead paragraph under a heading. */
export const infoLead = "max-w-[62ch] text-[17px] leading-[27px] text-muted-foreground";

export function FeatureIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
      <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
    </span>
  );
}

/** Icon, title and body per item: one column on phones, two from the desktop breakpoint. */
export function FeatureList({
  items,
  icons,
}: {
  items: readonly { title: string; body: string }[];
  icons: LucideIcon[];
}) {
  return (
    <ul className="grid grid-cols-1 gap-x-10 gap-y-7 desktop:grid-cols-2">
      {items.map((item, i) => (
        <li key={item.title} className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3.5">
          <FeatureIcon icon={icons[i] ?? MessageCircle} />
          <div className="flex flex-col gap-1">
            <h3 className="leading-[22px] font-[650]">{item.title}</h3>
            <p className="text-muted-foreground">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
