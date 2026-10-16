import { cn } from "@/lib/cn";

/**
 * Indeterminate loading spinner. Purely decorative — the surrounding control
 * is responsible for `aria-busy` / status text.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
