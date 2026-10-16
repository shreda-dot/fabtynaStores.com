import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FormFieldProps = {
  id: string;
  label: string;
  /** Links extra guidance to the control via `aria-describedby`. */
  hint?: string;
  /** Inline error; rendered with `role="alert"` and linked to the control. */
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Label + control + hint/error wrapper.
 *
 * The child control should reference `aria-describedby` with
 * `${id}-hint` / `${id}-error` when those are present; the ids used here are
 * stable so controls can always point at them.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function fieldDescribedBy(id: string, options: { hint?: string; error?: string }): string | undefined {
  const ids: string[] = [];
  if (options.hint) ids.push(`${id}-hint`);
  if (options.error) ids.push(`${id}-error`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
