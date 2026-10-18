import type * as React from "react";
import { cn } from "~/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full resize-y rounded-md border border-input bg-card p-3 text-base leading-6 text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
