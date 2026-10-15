"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, formatNaira } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { stockApi, transfersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { StockTransferDto } from "@fabtyna/shared";

export default function TransfersPage() {
  const transfers = useQuery({
    queryKey: queryKeys.transfers.list,
    queryFn: () => transfersApi.list(),
  });

  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

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

  const totalWorth =
    stock.data?.reduce((sum, row) => sum + BigInt(row.worthAtCostKobo), 0n) ??
    0n;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Move stock between locations. Current stock value at cost:{" "}
            <span className="font-medium">
              {formatNaira(totalWorth.toString())}
            </span>
          </p>
        </div>
        <Link
          href="/transfers/new"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New transfer
        </Link>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        {transfers.isPending ? (
          <ListLoading />
        ) : transfers.isError ? (
          <ListError
            message={
              transfers.error.message || "Transfers could not be loaded."
            }
            retry={() => void transfers.refetch()}
          />
        ) : transfers.data.length === 0 ? (
          <ListEmpty message="No transfers yet. Move stock between locations by creating a transfer." />
        ) : (
          <ResponsiveTable
            rows={transfers.data}
            columns={columns}
            getKey={(transfer) => transfer.id}
          />
        )}
      </section>
    </div>
  );
}
