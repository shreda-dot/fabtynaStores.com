"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const lagosTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatLastUpdated(timestampMs: number): string {
  return lagosTime.format(new Date(timestampMs));
}

/** "Last updated" time (Lagos) plus a manual refresh button. */
export function ReportToolbar({
  dataUpdatedAt,
  isFetching,
  onRefresh,
}: {
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {dataUpdatedAt > 0
          ? `Last updated ${formatLastUpdated(dataUpdatedAt)} (Lagos time)`
          : "Not loaded yet"}
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={onRefresh}
        loading={isFetching}
      >
        <RefreshCw aria-hidden="true" className="h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
}
