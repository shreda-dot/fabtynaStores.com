"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Warehouse } from "lucide-react";
import Link from "next/link";
import { formatStockUnits } from "@fabtyna/shared";
import { InfoHint } from "@/components/info-hint";
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

export default function WarehouseInventoryPage() {
  const stock = useQuery({
    queryKey: queryKeys.stock.allProducts,
    queryFn: () => listAllStock(stockApi),
  });

  const { items: rows, totals } = useMemo(
    () => departmentStock(stock.data ?? [], "WAREHOUSE"),
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
      header: "In warehouse",
      align: "right",
      render: (item) => (
        <span className="tabular">
          {formatStockUnits(item.units, item.row.unitsPerPack, item.row.packName)}
        </span>
      ),
    },
    {
      header: "Packs",
      align: "right",
      render: (item) => <span className="tabular">{(item.units / item.row.unitsPerPack).toFixed(1)}</span>,
    },
    {
      header: "Warehouse units at cost",
      align: "right",
      render: (item) => <Money kobo={item.cost} />,
    },
    {
      header: "Warehouse units at wholesale price",
      align: "right",
      render: (item) => <Money kobo={item.sell} />,
    },
    {
      header: "Warehouse expected balance",
      align: "right",
      render: (item) => <Money kobo={item.balance} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse"
        description="Wholesale stock stored in the warehouse."
        actions={
          <Link
            href="/purchases/new"
            className={buttonClasses({ variant: "primary" })}
          >
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
            Receive stock
          </Link>
        }
      />

      {stock.data && !stock.isError && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Warehouse units at wholesale price"
          value={<Money kobo={totals.sell} tone="neutral" />}
          hint={
            <InfoHint label="Explain wholesale worth if sold">
              Your current wholesale selling price applied to the stock
              presently in the warehouse.
            </InfoHint>
          }
        />
        <StatCard
          label="Warehouse units at average cost"
          value={<Money kobo={totals.cost} tone="neutral" />}
          hint={
            <InfoHint label="Explain wholesale worth when bought">
              Warehouse units valued at the product&apos;s average cost per unit.
            </InfoHint>
          }
        />
        <StatCard
          label="Warehouse expected balance"
          value={<Money kobo={totals.balance} />}
          tone={totals.balance < 0n ? "danger" : "default"}
          hint={
            <InfoHint label="Explain warehouse balance">
              Warehouse units at wholesale price minus the same units at average cost.
            </InfoHint>
          }
        />
        <StatCard
          label="Total units in warehouse"
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
          icon={Warehouse}
          title="No stock in the warehouse"
          description="Warehouse stock appears here once you receive items through a purchase."
          action={
            <Link
              href="/purchases/new"
              className={buttonClasses({ variant: "primary" })}
            >
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
              Receive stock
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
