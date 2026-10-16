"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDate,
  formatNaira,
  getLagosBusinessDate,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { purchasesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { PurchaseListItemDto } from "@/lib/api/purchases.api";

export default function PurchasesPage() {
  const queryClient = useQueryClient();
  void queryClient;

  const [filterDate, setFilterDate] = useState("");
  const businessDate = useLagosBusinessDate();

  const purchases = useQuery({
    queryKey: queryKeys.purchases.list,
    queryFn: () => purchasesApi.list(),
  });

  const rows = useMemo(() => {
    return (purchases.data ?? [])
      .filter(
        (purchase) =>
          filterDate === "" ||
          getLagosBusinessDate(new Date(purchase.purchasedAt)) === filterDate,
      )
      .sort(
        (a, b) =>
          new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime(),
      );
  }, [purchases.data, filterDate]);

  const columns: ResponsiveTableColumn<PurchaseListItemDto>[] = [
    {
      header: "Reference",
      render: (purchase) => (
        <Link
          href={`/purchases/${purchase.id}`}
          className="font-medium text-primary hover:underline"
        >
          {purchase.reference ?? purchase.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Supplier",
      render: (purchase) => purchase.supplierName ?? "No supplier",
    },
    {
      header: "Date",
      render: (purchase) => formatLagosDate(purchase.purchasedAt),
    },
    {
      header: "Lines",
      render: (purchase) => purchase.lineCount.toString(),
    },
    {
      header: "Total",
      render: (purchase) => formatNaira(purchase.totalKobo),
    },
    {
      header: "Status",
      render: (purchase) => (
        <span
          className={
            purchase.status === "VOIDED"
              ? "text-destructive"
              : purchase.status === "RECEIVED"
                ? "text-green-700 dark:text-green-400"
                : ""
          }
        >
          {purchase.status}
        </span>
      ),
    },
    {
      header: "",
      render: (purchase) => (
        <Link
          href={`/purchases/${purchase.id}`}
          className="text-sm text-primary hover:underline"
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
          <h1 className="text-2xl font-semibold tracking-tight">Purchases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Record goods received into your store.
          </p>
        </div>
        <Link
          href="/purchases/new"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New purchase
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

        {purchases.isPending ? (
          <ListLoading />
        ) : purchases.isError ? (
          <ListError
            message={
              purchases.error.message || "Purchases could not be loaded."
            }
            retry={() => void purchases.refetch()}
          />
        ) : rows.length === 0 ? (
          <ListEmpty message="No purchases match these filters." />
        ) : (
          <ResponsiveTable
            rows={rows}
            columns={columns}
            getKey={(purchase) => purchase.id}
          />
        )}
      </section>
    </div>
  );
}
