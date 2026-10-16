import { Skeleton } from "./skeleton";

export type PageSkeletonVariant = "list" | "detail" | "form" | "dashboard" | "report";

/**
 * Region-scoped skeleton that mirrors a page's layout so the static chrome
 * (sidebar, top bar) stays visible and nothing jumps when data arrives.
 */
export function PageSkeleton({ variant = "list" }: { variant?: PageSkeletonVariant }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="h-6 w-40 animate-pulse rounded-sm bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="h-11 w-32 animate-pulse rounded-md bg-muted" />
      </div>

      {variant === "dashboard" && (
        <>
          <Skeleton variant="stat" count={4} />
          <Skeleton variant="card" count={2} />
        </>
      )}

      {variant === "report" && (
        <>
          <div className="h-16 animate-pulse rounded-md border border-border bg-muted" />
          <Skeleton variant="stat" count={3} />
          <Skeleton variant="row" count={6} />
        </>
      )}

      {(variant === "list" || variant === "report") && (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="h-11 w-full animate-pulse rounded-md bg-muted sm:w-64" />
            <div className="h-11 w-32 animate-pulse rounded-md bg-muted" />
            <div className="h-11 w-32 animate-pulse rounded-md bg-muted" />
          </div>
          <Skeleton variant="row" count={6} />
        </>
      )}

      {variant === "detail" && (
        <>
          <div className="h-20 animate-pulse rounded-md border border-border bg-muted" />
          <Skeleton variant="row" count={4} />
        </>
      )}

      {variant === "form" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-40 animate-pulse rounded-md border border-border bg-muted" />
          <div className="flex justify-end gap-2">
            <div className="h-11 w-28 animate-pulse rounded-md bg-muted" />
            <div className="h-11 w-36 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      )}

      <span className="sr-only">Loading…</span>
    </div>
  );
}
