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

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

export default function WarehouseInventoryPage() {
  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

  const rows = useMemo(() => {
    return (stock.data ?? [])
      .map((row) => {
        const breakdown = row.byLocation.find(
          (b) => b.location === "WAREHOUSE",
        );
        const units = breakdown?.quantityUnits ?? 0;
        const packs = units > 0 ? units / row.unitsPerPack : 0;
        const sellWorth = BigInt(row.wholesaleWorthKobo);
        const buyWorth =
          row.totalUnits > 0
            ? roundHalfUp(
                BigInt(row.worthAtCostKobo) * BigInt(units),
                BigInt(row.totalUnits),
              )
            : 0n;
        const balance = sellWorth - buyWorth;
        return { row, units, packs, sellWorth, buyWorth, balance };
      })
      .filter((item) => item.units > 0);
  }, [stock.data]);

  const totalSellWorth = rows.reduce((sum, item) => sum + item.sellWorth, 0n);
  const totalBuyWorth = rows.reduce((sum, item) => sum + item.buyWorth, 0n);
  const totalBalance = rows.reduce((sum, item) => sum + item.balance, 0n);
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
      render: (item) => <span className="tabular">{item.packs.toFixed(1)}</span>,
    },
    {
      header: "Buy worth",
      align: "right",
      render: (item) => <Money kobo={item.buyWorth} />,
    },
    {
      header: "Wholesale worth",
      align: "right",
      render: (item) => <Money kobo={item.sellWorth} />,
    },
    {
      header: "Balance",
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Wholesale worth if sold"
          value={<Money kobo={totalSellWorth} tone="neutral" />}
          hint={
            <InfoHint label="Explain wholesale worth if sold">
              Your current wholesale selling price applied to the stock
              presently in the warehouse.
            </InfoHint>
          }
        />
        <StatCard
          label="Wholesale worth when bought"
          value={<Money kobo={totalBuyWorth} tone="neutral" />}
          hint={
            <InfoHint label="Explain wholesale worth when bought">
              The cost value of the same warehouse stock — what it was bought
              for.
            </InfoHint>
          }
        />
        <StatCard
          label="Balance"
          value={<Money kobo={totalBalance} />}
          tone={totalBalance < 0n ? "danger" : "default"}
          hint={
            <InfoHint label="Explain warehouse balance">
              Balance is “wholesale worth if sold” minus “wholesale worth when
              bought”. It shows how strong or tight your current selling margin
              is.
            </InfoHint>
          }
        />
        <StatCard
          label="Total units in warehouse"
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
