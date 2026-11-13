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
import { listAllStock } from "@/lib/api/stock.api";
import { departmentStock } from "@/lib/stock-valuation";

export default function RetailInventoryPage() {
  const stock = useQuery({
    queryKey: queryKeys.stock.allProducts,
    queryFn: () => listAllStock(stockApi),
  });

  const { items: rows, totals } = useMemo(
    () => departmentStock(stock.data ?? [], "RETAIL_SHELF"),
    [stock.data],
  );

  const columns: ResponsiveTableColumn<(typeof rows)[number]>[] = [
    {
      header: "Product",
      render: (item) => (
        <div>
          <p className="font-medium">{item.row.productName}{!item.row.active && " (inactive)"}</p>
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
      header: "Fridge units at retail price",
      align: "right",
      render: (item) => <Money kobo={item.sell} />,
    },
    {
      header: "Fridge units at average cost",
      align: "right",
      render: (item) => <Money kobo={item.cost} />,
    },
    {
      header: "Fridge expected balance",
      align: "right",
      render: (item) => <Money kobo={item.balance} />,
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

      {stock.data && !stock.isError && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Fridge units at retail price"
          value={<Money kobo={totals.sell} tone="neutral" />}
        />
        <StatCard
          label="Fridge units at average cost"
          value={<Money kobo={totals.cost} tone="neutral" />}
        />
        <StatCard
          label="Fridge expected balance"
          value={<Money kobo={totals.balance} />}
          tone={totals.balance < 0n ? "danger" : "default"}
        />
        <StatCard
          label="Total units in fridge"
          value={<span className="tabular">{totals.units}</span>}
        />
      </div>}

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
