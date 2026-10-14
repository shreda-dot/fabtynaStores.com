export function ListLoading() {
  return (
    <div className="space-y-3" aria-label="Loading list" role="status">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted md:h-12"
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ListEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-5 py-12 text-center">
      <p className="font-medium">No records found</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function ListError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={retry}
        className="min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
      >
        Try again
      </button>
    </div>
  );
}
