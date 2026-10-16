"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { ResponsiveTable } from "@/components/responsive-table";
import type { ResponsiveTableColumn } from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { purchasesApi } from "@/lib/api";
import type { PurchaseListItemDto } from "@/lib/api/purchases.api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export default function PurchasesPage() {
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
      align: "right",
      render: (purchase) => <span className="tabular">{purchase.lineCount}</span>,
    },
    {
      header: "Total",
      align: "right",
      render: (purchase) => <Money kobo={purchase.totalKobo} tone="neutral" />,
    },
    {
      header: "Status",
      render: (purchase) => <StatusBadge status={purchase.status} />,
    },
    {
      header: "",
      align: "right",
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

  const hasAnyPurchase = (purchases.data?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="Record goods received into your store."
        actions={
          <Link href="/purchases/new" className={buttonClasses({})}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New purchase
          </Link>
        }
      />

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter
            id="f-date"
            value={filterDate}
            onChange={setFilterDate}
            max={businessDate}
          />
        </div>

        {purchases.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : purchases.isError ? (
          <ErrorState
            title="Purchases could not be loaded"
            message={toUserMessage(purchases.error)}
            onRetry={() => void purchases.refetch()}
          />
        ) : rows.length === 0 ? (
          hasAnyPurchase ? (
            <EmptyState
              title="No purchases match these filters"
              description="Try clearing the date filter."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilterDate("")}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No purchases yet"
              description="Record goods received into your store to build your purchase history."
              action={
                <Link
                  href="/purchases/new"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  New purchase
                </Link>
              }
            />
          )
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
