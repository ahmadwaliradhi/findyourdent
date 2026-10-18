import { cva, type VariantProps } from "class-variance-authority";
import { CircleCheck, Clock, Info, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * A boxed message about where something stands: a soft ground, an icon and the words,
 * so the status never rides on color alone. Errors use ErrorNotice.
 */
const noticeVariants = cva("flex items-start gap-3 rounded-md border px-4 py-3 text-sm leading-5 text-foreground", {
  variants: {
    tone: {
      info: "border-info-line bg-info-soft [&>svg]:text-info",
      warning: "border-warning-line bg-warning-soft [&>svg]:text-warning",
      success: "border-success-line bg-success-soft [&>svg]:text-success",
      neutral: "border-transparent bg-muted [&>svg]:text-muted-foreground",
    },
  },
  defaultVariants: { tone: "info" },
});

const TONE_ICON: Record<NonNullable<VariantProps<typeof noticeVariants>["tone"]>, LucideIcon> = {
  info: Info,
  warning: Clock,
  success: CircleCheck,
  neutral: Info,
};

function Notice({
  className,
  tone,
  icon,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof noticeVariants> & { icon?: LucideIcon }) {
  const Icon = icon ?? TONE_ICON[tone ?? "info"];
  return (
    <div className={cn(noticeVariants({ tone }), className)} {...props}>
      <Icon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

export { Notice };
