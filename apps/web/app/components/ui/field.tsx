import { OctagonAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";
import { Textarea } from "./textarea";

/**
 * Labelled multi-line text input: visible label, optional hint, and an error with an icon,
 * wired with aria-describedby and aria-invalid. See docs/design/design-system/components/Field.
 */
function Field({
  id,
  label,
  hint,
  error,
  className,
  rows = 4,
  ...props
}: Omit<React.ComponentProps<"textarea">, "id"> & {
  id: string;
  /** Always visible; never replaced by the placeholder. */
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** Shown under the field with an icon; also sets aria-invalid. */
  error?: React.ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div data-slot="field" className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm leading-5 font-semibold text-foreground">
        {label}
      </label>
      <Textarea id={id} rows={rows} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** Native inputs and selects styled like the other inputs, so they stay keyboard and screen-reader friendly. */
const fieldClassName =
  "min-h-touch w-full rounded-md border border-input bg-card px-3 text-base shadow-xs focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-destructive";

/** An error line under an input: an icon and what to do, in danger text. */
function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("flex items-start gap-2 text-sm leading-5 font-medium text-destructive", className)} {...props}>
      <OctagonAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export { Field, FieldError, fieldClassName };
