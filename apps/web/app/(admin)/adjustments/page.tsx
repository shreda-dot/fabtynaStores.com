"use client";

import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Ban, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import type { StockAdjustmentDto } from "@fabtyna/shared";
import {
  DateRangeFilter,
  defaultListRange,
  lastDaysRange,
} from "@/components/date-range-filter";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { adjustmentsApi } from "@/lib/api";
import { isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { invalidateReportsAndBalances } from "@/lib/invalidate-after-write";
import { validateReportRange } from "@/lib/report-range";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { WriteFlowStatus } from "@/components/write-flow-status";

const PAGE_SIZE = 50;

export default function AdjustmentsPage() {
  const today = useLagosBusinessDate() || getLagosBusinessDate();
  const [range, setRange] = useState(() => defaultListRange(getLagosBusinessDate()));
  const problem = validateReportRange(range.from, range.to);
  const network = useNetworkStatus();
  const queryClient = useQueryClient();
  const writeFlow = useWriteFlow();
  const [lastVoidId, setLastVoidId] = useState("");

  const adjustments = useInfiniteQuery({
    queryKey: queryKeys.adjustments.pages({ from: range.from, to: range.to }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      adjustmentsApi.listPage({
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: problem === null,
  });

  // Read before the render branches narrow `adjustments`.
  const loadMoreFailed = adjustments.isFetchNextPageError;
  const queryError: unknown = adjustments.error;
  const fetchNext = adjustments.fetchNextPage;

  const voidMutation = useMutation({
    mutationFn: async (adjustmentId: string) => {
      if (isMockApiMode) return adjustmentsApi.void(adjustmentId);
      if (writeFlow.status === "unknown" && adjustmentId !== lastVoidId) return undefined;
      if (writeFlow.status === "failed" && adjustmentId !== lastVoidId) writeFlow.edit();
      setLastVoidId(adjustmentId);
      return writeFlow.run((key) => adjustmentsApi.void(adjustmentId, key));
    },
    onSuccess: (result) => {
      if (!result) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.adjustments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void invalidateReportsAndBalances(queryClient);
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const rows = useMemo(
    () => (adjustments.data?.pages ?? []).flatMap((page) => page.items),
    [adjustments.data],
  );

  async function tryVoid(a: StockAdjustmentDto) {
    await confirm({
      title: "Void this adjustment?",
      tone: "danger",
      confirmLabel: "Void adjustment",
      cancelLabel: "Keep adjustment",
      description: "This cannot be undone.",
      details: (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>The stock movements from this adjustment will be reversed.</li>
          <li>Stock levels return to what they were before the adjustment.</li>
          <li>
            The record stays in history marked <strong>VOIDED</strong>.
          </li>
        </ul>
      ),
      onConfirm: () => voidMutation.mutateAsync(a.id),
    });
  }

  const columns: ResponsiveTableColumn<StockAdjustmentDto>[] = [
    {
      header: "Date",
      render: (a) => formatLagosDate(a.adjustedAt),
    },
    {
      header: "Reason",
      render: (a) => a.reason,
    },
    {
      header: "Status",
      render: (a) => <StatusBadge status={a.status} />,
    },
    {
      header: "Actions",
      align: "right",
      render: (a) => (
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/adjustments/${a.id}`}
            className="font-medium text-primary hover:underline"
          >
            View
          </Link>
          {a.status === "COMPLETED" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10"
              loading={
                voidMutation.isPending && voidMutation.variables === a.id
              }
              disabled={voidMutation.isPending || network.offline || writeFlow.status === "unknown"}
              onClick={() => void tryVoid(a)}
            >
              <Ban aria-hidden="true" className="h-3.5 w-3.5" />
              Void
            </Button>
          )}
        </div>
      ),
    },
  ];

  const scope =
    range.from === range.to ? range.from : `${range.from} to ${range.to}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Adjustments"
        description="Correct stock counts for damaged, lost or found items."
        actions={
          <Link href="/adjustments/new" className={buttonClasses({ size: "md" })}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New adjustment
          </Link>
        }
      />
      <WriteFlowStatus
        flow={writeFlow}
        onRetry={() => {
          if (lastVoidId) voidMutation.mutate(lastVoidId);
        }}
        checkHref="/adjustments"
        checkLabel="Check adjustments"
        showFieldErrors
      />

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <DateRangeFilter
          idPrefix="adjustments"
          from={range.from}
          to={range.to}
          today={today}
          onChange={setRange}
          problem={problem}
        />

        {problem !== null ? null : adjustments.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : adjustments.isError && !loadMoreFailed ? (
          <ErrorState
            title="Adjustments could not be loaded"
            message={toUserMessage(queryError)}
            onRetry={() => void adjustments.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Scale}
            title={`No adjustments for ${scope}`}
            description="Choose another period, or record a correction when stock counts change for damage, loss or found items."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRange(lastDaysRange(today, 365))}
                >
                  Show the last 12 months
                </Button>
                <Link
                  href="/adjustments/new"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  New adjustment
                </Link>
              </div>
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {rows.length} adjustments for {scope}
              {adjustments.hasNextPage ? " (more available)" : ""}.
            </p>
            <ResponsiveTable rows={rows} columns={columns} getKey={(a) => a.id} />
            {loadMoreFailed && (
              <ErrorState
                title="More adjustments could not be loaded"
                message={toUserMessage(queryError)}
                onRetry={() => void fetchNext()}
              />
            )}
            {adjustments.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  loading={adjustments.isFetchingNextPage}
                  onClick={() => void adjustments.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}