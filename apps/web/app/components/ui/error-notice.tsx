import { OctagonAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

/** A boxed error: danger-soft ground, an icon and the message, with any follow-up action under it. */
function ErrorNotice({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive-line bg-destructive-soft px-3 py-3 text-sm text-foreground",
        className,
      )}
      {...props}
    >
      <OctagonAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

export { ErrorNotice };
