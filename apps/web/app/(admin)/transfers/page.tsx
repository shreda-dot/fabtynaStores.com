"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Plus } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
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
import type { StockTransferDto } from "@fabtyna/shared";

export default function TransfersPage() {
  const [filterDate, setFilterDate] = useState("");
  const businessDate = useLagosBusinessDate();

  const transfers = useQuery({
    queryKey: queryKeys.transfers.list,
    queryFn: () => transfersApi.list(),
  });

  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

  const rows = useMemo(() => {
    return (transfers.data ?? [])
      .filter(
        (transfer) =>
          filterDate === "" ||
          getLagosBusinessDate(new Date(transfer.transferredAt)) === filterDate,
      )
      .sort(
        (a, b) =>
          new Date(b.transferredAt).getTime() -
          new Date(a.transferredAt).getTime(),
      );
  }, [transfers.data, filterDate]);

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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter
            id="transfers-date"
            value={filterDate}
            onChange={setFilterDate}
            max={businessDate}
          />
        </div>

        {transfers.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : transfers.isError ? (
          <ErrorState
            title="Transfers could not be loaded"
            message={toUserMessage(transfers.error)}
            onRetry={() => void transfers.refetch()}
          />
        ) : rows.length === 0 ? (
          filterDate !== "" ? (
            <EmptyState
              title="No transfers match these filters"
              description="Try clearing the date filter."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilterDate("")}
                >
                  Clear filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ArrowLeftRight}
              title="No transfers yet"
              description="Move stock between the warehouse, shelf and market to keep counts accurate."
              action={
                <Link
                  href="/transfers/new"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  New transfer
                </Link>
              }
            />
          )
        ) : (
          <ResponsiveTable
            rows={rows}
            columns={columns}
            getKey={(transfer) => transfer.id}
          />
        )}
      </section>
    </div>
  );
}
