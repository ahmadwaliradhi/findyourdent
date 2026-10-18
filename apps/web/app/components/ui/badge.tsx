import { cva, type VariantProps } from "class-variance-authority";
import { Check, Clock, Info, type LucideIcon, OctagonAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Short label for the state or kind of something. Status variants carry an icon so meaning
 * never rides on color alone. See docs/design/design-system/components/Badge.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-2 py-0.5 text-xs font-semibold leading-4 tracking-[.01em] [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-foreground",
        brand: "bg-secondary text-secondary-foreground",
        success: "border-success-line bg-success-soft text-success",
        warning: "border-warning-line bg-warning-soft text-warning",
        danger: "border-destructive-line bg-destructive-soft text-destructive",
        info: "border-info-line bg-info-soft text-info",
        outline: "border-border-strong bg-transparent text-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

const STATUS_ICON: Partial<Record<NonNullable<VariantProps<typeof badgeVariants>["variant"]>, LucideIcon>> = {
  success: Check,
  warning: Clock,
  danger: OctagonAlert,
  info: Info,
};

function Badge({
  className,
  variant,
  icon,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Overrides the status icon; `false` for none. */
    icon?: LucideIcon | false;
  }) {
  const Icon = icon === false ? null : (icon ?? (variant ? STATUS_ICON[variant] : undefined));
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {Icon && <Icon aria-hidden="true" strokeWidth={1.75} />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
