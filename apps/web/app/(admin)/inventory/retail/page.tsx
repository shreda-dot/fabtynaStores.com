"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Refrigerator, RefreshCw } from "lucide-react";
import Link from "next/link";
import { formatStockUnits } from "@fabtyna/shared";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { stockApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
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
      align: "right",
      render: (item) => (
        <span className="tabular">
          {formatStockUnits(item.units, item.row.unitsPerPack, item.row.packName)}
        </span>
      ),
    },
    {
      header: "Retail worth",
      align: "right",
      render: (item) => <Money kobo={item.worth} />,
    },
    {
      header: "Action",
      align: "right",
      render: (item) => (
        <Link
          href={`/transfers/new?productId=${item.row.productId}&to=RETAIL_SHELF`}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Restock
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fridge (Retail)"
        description="Products currently in the retail shelf / fridge."
        actions={
          <Link
            href="/transfers/new?to=RETAIL_SHELF"
            className={buttonClasses({ variant: "primary" })}
          >
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
            Transfer to fridge
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Retail stock worth"
          value={<Money kobo={totalWorth} tone="neutral" />}
        />
        <StatCard
          label="Total units in fridge"
          value={<span className="tabular">{totalUnits}</span>}
        />
      </div>

      {stock.isPending ? (
        <Skeleton variant="row" count={6} />
      ) : stock.isError ? (
        <ErrorState
          message={toUserMessage(stock.error)}
          onRetry={() => void stock.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Refrigerator}
          title="No products in the fridge"
          description="Move stock from the warehouse to the retail shelf to see it here."
          action={
            <Link
              href="/transfers/new?to=RETAIL_SHELF"
              className={buttonClasses({ variant: "primary" })}
            >
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
              Transfer to fridge
            </Link>
          }
        />
      ) : (
        <ResponsiveTable
          rows={rows}
          columns={columns}
          getKey={(item) => item.row.productId}
        />
      )}
    </div>
  );
}
