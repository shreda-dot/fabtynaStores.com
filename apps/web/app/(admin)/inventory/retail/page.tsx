"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { formatNaira, formatStockUnits } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { stockApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export default function RetailInventoryPage() {
  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

  const rows = useMemo(() => {
    return (stock.data ?? [])
      .map((row) => {
        const breakdown = row.byLocation.find(
          (b) => b.location === "RETAIL_SHELF",
        );
        const units = breakdown?.quantityUnits ?? 0;
        const worth = BigInt(row.retailWorthKobo);
        return { row, units, worth };
      })
      .filter((item) => item.units > 0);
  }, [stock.data]);

  const totalWorth = rows.reduce((sum, item) => sum + item.worth, 0n);
  const totalUnits = rows.reduce((sum, item) => sum + item.units, 0);

  const columns: ResponsiveTableColumn<(typeof rows)[number]>[] = [
    {
      header: "Product",
      render: (item) => (
        <div>
          <p className="font-medium">{item.row.productName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.row.sku ?? "No SKU"}
          </p>
        </div>
      ),
    },
    {
      header: "Units in fridge",
      render: (item) =>
        formatStockUnits(item.units, item.row.unitsPerPack, item.row.packName),
    },
    {
      header: "Retail worth",
      render: (item) => formatNaira(item.worth.toString()),
    },
    {
      header: "Action",
      render: (item) => (
        <Link
          href={`/transfers/new?productId=${item.row.productId}&to=RETAIL_SHELF`}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          Restock
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fridge (Retail)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Products currently in the retail shelf / fridge.
          </p>
        </div>
        <Link
          href="/transfers/new?to=RETAIL_SHELF"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
          Transfer to fridge
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Retail stock worth</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatNaira(totalWorth.toString())}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total units in fridge</p>
          <p className="mt-1 text-2xl font-semibold">{totalUnits}</p>
        </div>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        {stock.isPending ? (
          <ListLoading />
        ) : stock.isError ? (
          <ListError
            message={stock.error.message || "Stock could not be loaded."}
            retry={() => void stock.refetch()}
          />
        ) : rows.length === 0 ? (
          <ListEmpty message="No products in the fridge. Transfer stock from the warehouse." />
        ) : (
          <ResponsiveTable
            rows={rows}
            columns={columns}
            getKey={(item) => item.row.productId}
          />
        )}
      </section>
    </div>
  );
}
