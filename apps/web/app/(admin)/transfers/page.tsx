"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Plus } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import type { StockTransferDto } from "@fabtyna/shared";
import {
  DateRangeFilter,
  defaultListRange,
  lastDaysRange,
} from "@/components/date-range-filter";
import { InfoHint } from "@/components/info-hint";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { stockApi, transfersApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { validateReportRange } from "@/lib/report-range";

const PAGE_SIZE = 50;

export default function TransfersPage() {
  const today = useLagosBusinessDate() || getLagosBusinessDate();
  const [range, setRange] = useState(() => defaultListRange(getLagosBusinessDate()));
  const problem = validateReportRange(range.from, range.to);

  const transfers = useInfiniteQuery({
    queryKey: queryKeys.transfers.pages({ from: range.from, to: range.to }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      transfersApi.listPage({
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: problem === null,
  });

  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

  // Read before the render branches narrow `transfers`.
  const loadMoreFailed = transfers.isFetchNextPageError;
  const queryError: unknown = transfers.error;
  const fetchNext = transfers.fetchNextPage;

  const rows = useMemo(
    () => (transfers.data?.pages ?? []).flatMap((page) => page.items),
    [transfers.data],
  );

  const totalWorth = (stock.data ?? []).reduce(
    (sum, row) => sum + BigInt(row.worthAtCostKobo),
    0n,
  );

  const columns: ResponsiveTableColumn<StockTransferDto>[] = [
    {
      header: "Reference",
      render: (transfer) => (
        <Link
          href={`/transfers/${transfer.id}`}
          className="font-medium text-primary hover:underline"
        >
          {transfer.reference ?? transfer.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "From",
      render: (transfer) => transfer.from.replace(/_/g, " "),
    },
    {
      header: "To",
      render: (transfer) => transfer.to.replace(/_/g, " "),
    },
    {
      header: "Date",
      render: (transfer) => formatLagosDate(transfer.transferredAt),
    },
    {
      header: "Reason",
      render: (transfer) => transfer.reason ?? "—",
    },
    {
      header: "",
      render: (transfer) => (
        <Link
          href={`/transfers/${transfer.id}`}
          className="text-sm text-primary hover:underline"
        >
          View
        </Link>
      ),
    },
  ];

  const scope =
    range.from === range.to ? range.from : `${range.from} to ${range.to}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transfers"
        description={
          <>
            Move stock between locations. Current stock value at cost{" "}
            <InfoHint label="Explain current stock value at cost">
              This is the purchase-cost value of all stock currently on hand
              across locations. A transfer only changes where the stock sits,
              not the total stock value by itself.
            </InfoHint>
            : <Money kobo={totalWorth} tone="neutral" />
          </>
        }
        actions={
          <Link href="/transfers/new" className={buttonClasses({ size: "md" })}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New transfer
          </Link>
        }
      />

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <DateRangeFilter
          idPrefix="transfers"
          from={range.from}
          to={range.to}
          today={today}
          onChange={setRange}
          problem={problem}
        />

        {problem !== null ? null : transfers.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : transfers.isError && !loadMoreFailed ? (
          <ErrorState
            title="Transfers could not be loaded"
            message={toUserMessage(queryError)}
            onRetry={() => void transfers.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={`No transfers for ${scope}`}
            description="Choose another period, or record a transfer to move stock between the warehouse, shelf and market."
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
                  href="/transfers/new"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  New transfer
                </Link>
              </div>
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {rows.length} transfers for {scope}
              {transfers.hasNextPage ? " (more available)" : ""}.
            </p>
            <ResponsiveTable
              rows={rows}
              columns={columns}
              getKey={(transfer) => transfer.id}
            />
            {loadMoreFailed && (
              <ErrorState
                title="More transfers could not be loaded"
                message={toUserMessage(queryError)}
                onRetry={() => void fetchNext()}
              />
            )}
            {transfers.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  loading={transfers.isFetchingNextPage}
                  onClick={() => void transfers.fetchNextPage()}
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