import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * One action. One `primary` per view; `danger` only for destructive actions.
 * Every size is at least 44px tall. See docs/design/design-system/components/Button.
 */
const buttonVariants = cva(
  "inline-flex min-w-touch shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-semibold leading-tight no-underline transition-[background-color,border-color,transform] duration-150 ease-[ease] motion-reduce:transition-none [-webkit-tap-highlight-color:transparent] enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:border-primary",
        outline: "border-border-strong bg-card text-foreground hover:border-foreground",
        ghost: "bg-transparent text-primary hover:bg-secondary",
        danger: "bg-destructive text-destructive-foreground shadow-xs hover:brightness-[.92]",
        /** Inline text action, still a full touch target. */
        link: "bg-transparent text-primary underline underline-offset-4",
      },
      size: {
        sm: "min-h-touch px-4 text-sm",
        md: "min-h-12 px-5 text-base",
        lg: "min-h-14 px-6 text-[17px]",
      },
      block: {
        true: "flex w-full",
      },
    },
    compoundVariants: [{ variant: "link", className: "min-h-touch px-1" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Shows a spinner, disables the button and sets aria-busy. Keep the label. */
    loading?: boolean;
    /** Leading icon, e.g. a lucide-react icon element. */
    icon?: React.ReactNode;
  };

function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  loading = false,
  icon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, block, className }));
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      data-slot="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-[18px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent [animation-duration:.7s] motion-reduce:[animation-duration:2s]"
    />
  );
}

export { Button, buttonVariants };
