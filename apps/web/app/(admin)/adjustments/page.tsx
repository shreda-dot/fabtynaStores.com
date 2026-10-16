"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { adjustmentsApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { StockAdjustmentDto } from "@fabtyna/shared";

export default function AdjustmentsPage() {
  const [filterDate, setFilterDate] = useState("");
  const businessDate = useLagosBusinessDate();

  const adjustments = useQuery({
    queryKey: queryKeys.adjustments.list,
    queryFn: () => adjustmentsApi.list(),
  });

  const rows = useMemo(() => {
    return (adjustments.data ?? [])
      .filter(
        (a) =>
          filterDate === "" ||
          getLagosBusinessDate(new Date(a.adjustedAt)) === filterDate,
      )
      .sort(
        (a, b) =>
          new Date(b.adjustedAt).getTime() - new Date(a.adjustedAt).getTime(),
      );
  }, [adjustments.data, filterDate]);

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
      render: (a) => (
        <span className={a.status === "VOIDED" ? "text-destructive" : ""}>
          {a.status}
        </span>
      ),
    },
    {
      header: "Actions",
      render: (a) => (
        <Link
          href={`/adjustments/${a.id}`}
          className="font-medium text-primary hover:underline"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Adjustments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Correct stock counts for damaged, lost or found items.
          </p>
        </div>
        <Link
          href="/adjustments/new"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New adjustment
        </Link>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter
            id="f-date"
            value={filterDate}
            onChange={setFilterDate}
            max={businessDate}
          />
        </div>

        {adjustments.isPending ? (
          <ListLoading />
        ) : adjustments.isError ? (
          <ListError
            message={
              adjustments.error.message || "Adjustments could not be loaded."
            }
            retry={() => void adjustments.refetch()}
          />
        ) : rows.length === 0 ? (
          <ListEmpty message="No adjustments match these filters." />
        ) : (
          <ResponsiveTable rows={rows} columns={columns} getKey={(a) => a.id} />
        )}
      </section>
    </div>
  );
}
