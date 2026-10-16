import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Shared control styling. Kept as a helper so `<Link>` and other elements can
 * reuse it without wrapping in an extra component.
 */
export function controlClasses(className?: string): string {
  return cn(
    "w-full rounded-md border border-input bg-surface px-3 text-base text-foreground",
    "placeholder:text-muted-foreground",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "aria-invalid:border-danger aria-invalid:outline-danger",
    className,
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={controlClasses(cn("min-h-11", className))} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={controlClasses(cn("min-h-24 py-2 leading-6", className))}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={controlClasses(cn("min-h-11 py-2", className))}>
      {children}
    </select>
  );
}
