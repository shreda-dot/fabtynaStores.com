import { cn } from "@/lib/cn";

export type SkeletonVariant = "text" | "card" | "row" | "stat";

export function Skeleton({
  variant = "text",
  className,
  count = 1,
}: {
  variant?: SkeletonVariant;
  className?: string;
  count?: number;
}) {
  const items = Array.from({ length: count }, (_, index) => index);

  if (variant === "card") {
    return (
      <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {items.map((index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-md border border-border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (variant === "stat") {
    return (
      <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
        {items.map((index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-md border border-border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div className={cn("space-y-2", className)} role="status" aria-label="Loading">
        {items.map((index) => (
          <div
            key={index}
            className="h-14 animate-pulse rounded-md border border-border bg-muted md:h-11"
          />
        ))}
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {items.map((index) => (
        <div key={index} className="h-4 animate-pulse rounded-sm bg-muted" />
      ))}
    </div>
  );
}
