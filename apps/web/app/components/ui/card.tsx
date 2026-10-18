import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Groups one thing a Patient reads as a unit. `emergency` is only for the IGD instruction:
 * it adds role="alert". `attention` is for a card that waits on the Patient, such as the follow-up question. See docs/design/design-system/components/Card.
 */
const cardVariants = cva("group/card flex flex-col gap-4 rounded-lg border p-5 text-card-foreground", {
  variants: {
    variant: {
      default: "bg-card shadow-sm",
      flat: "bg-card",
      emergency: "border-2 border-destructive-line bg-destructive-soft",
      attention: "border-2 border-primary bg-card shadow-sm",
    },
  },
  defaultVariants: { variant: "default" },
});

function Card({
  className,
  variant,
  labelledBy,
  ...props
}: React.ComponentProps<"section"> & VariantProps<typeof cardVariants> & { labelledBy?: string }) {
  return (
    <section
      data-slot="card"
      data-variant={variant ?? "default"}
      role={variant === "emergency" ? "alert" : undefined}
      aria-labelledby={labelledBy}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn(
        "text-xl leading-[26px] font-[650] tracking-[-.005em] group-data-[variant=emergency]/card:text-2xl group-data-[variant=emergency]/card:leading-[30px] group-data-[variant=emergency]/card:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
