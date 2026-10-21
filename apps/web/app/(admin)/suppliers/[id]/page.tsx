"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, ScrollText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDate } from "@fabtyna/shared";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { suppliersApi } from "@/lib/api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import type { SupplierStatementEntryDto } from "@/lib/api/suppliers.api";
import { queryKeys } from "@/lib/query-keys";

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supplier = useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => suppliersApi.getById(id),
  });
  const statement = useInfiniteQuery({
    queryKey: [...queryKeys.suppliers.detail(id), "statement"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      suppliersApi.getStatement(id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  if (supplier.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" className="h-8 w-56" />
        <Skeleton variant="stat" count={3} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }
  if (supplier.isError) {
    if (supplier.error instanceof ApiError && supplier.error.kind === "not-found") {
      return (
        <EmptyState
          title="Supplier not found"
          description="This supplier may have been removed, or the link is incorrect."
          action={
            <Link href="/suppliers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Back to suppliers
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        message={toUserMessage(supplier.error)}
        onRetry={() => void supplier.refetch()}
      />
    );
  }

  const profile = supplier.data;
  const s = profile.supplier;
  const recentPurchases = profile.recentPurchases;
  const unpaidPurchases = profile.unpaidPurchases;
  const statementEntries =
    statement.data?.pages.flatMap((page) => page.entries) ?? [];
  const purchaseColumns: ResponsiveTableColumn<(typeof recentPurchases)[number]>[] = [
    { header: "Date", render: (purchase) => formatLagosDate(purchase.purchasedAt) },
    {
      header: "Reference",
      render: (purchase) => (
        <Link href={`/purchases/${purchase.id}`} className="text-primary hover:underline">
          {purchase.reference ?? purchase.id.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Total", align: "right", render: (purchase) => <Money kobo={purchase.totalKobo} /> },
    { header: "Paid", align: "right", render: (purchase) => <Money kobo={purchase.paidKobo} /> },
    { header: "Status", align: "center", render: (purchase) => <StatusBadge status={purchase.status} /> },
  ];
  const ledgerColumns: ResponsiveTableColumn<SupplierStatementEntryDto>[] = [
    { header: "Date", render: (entry) => formatLagosDate(entry.occurredAt) },
    {
      header: "Type",
      render: (entry) => entry.isReversal ? `${entry.type} (reversal)` : entry.type,
    },
    {
      header: "Amount",
      align: "right",
      render: (entry) => <Money kobo={entry.amountKobo} />,
    },
    {
      header: "Balance",
      align: "right",
      render: (entry) => <Money kobo={entry.runningBalanceKobo} />,
    },
    {
      header: "Description",
      render: (entry) => entry.sourceDescription ?? entry.note ?? "—",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.name}
        description={`${s.phone ?? "No phone"} · ${s.email ?? "no email"}`}
        actions={
          <Link href="/suppliers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to suppliers
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Balance owed"
          value={<Money kobo={profile.balanceOwedKobo} tone="auto" />}
          tone={BigInt(profile.balanceOwedKobo) > 0n ? "danger" : "default"}
        />
        <StatCard label="Unpaid purchases" value={unpaidPurchases.length} />
        <StatCard label="Account status" value={s.active ? "Active" : "Inactive"} />
      </div>
      <Card>
        <CardHeader title="Contact" />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">Phone</dt><dd>{s.phone ?? "—"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Email</dt><dd>{s.email ?? "—"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Address</dt><dd>{s.address ?? "—"}</dd></div>
            {s.notes && <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Notes</dt><dd>{s.notes}</dd></div>}
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Outstanding purchases" description="Overdue status is calculated by the API using Lagos business dates." />
        <CardBody>
          {unpaidPurchases.length === 0 ? (
            <EmptyState icon={Package} title="No unpaid purchases" description="This supplier has no outstanding purchases." />
          ) : (
            <div className="space-y-3">
              {unpaidPurchases.map((purchase) => (
                <div key={purchase.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <Link href={`/purchases/${purchase.id}`} className="font-medium text-primary hover:underline">
                      {purchase.reference ?? purchase.id.slice(0, 8)}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {formatLagosDate(purchase.purchasedAt)}
                      {purchase.dueDate ? ` · Due ${formatLagosDate(purchase.dueDate)}` : ""}
                      {purchase.overdue ? ` · ${purchase.daysOverdue} days overdue` : ""}
                    </p>
                  </div>
                  <Money kobo={purchase.balanceDueKobo} tone="auto" />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent purchases" description="The API profile includes the 10 most recent purchases." />
        <CardBody>
          {recentPurchases.length === 0 ? (
            <EmptyState icon={Package} title="No purchases yet" description="Purchases from this supplier will appear here." />
          ) : (
            <ResponsiveTable rows={recentPurchases} columns={purchaseColumns} getKey={(purchase) => purchase.id} />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Ledger statement" description="All available supplier ledger history." />
        <CardBody className="space-y-4">
          {statement.isPending ? (
            <Skeleton variant="row" count={4} />
          ) : statement.isError ? (
            <ErrorState message={toUserMessage(statement.error)} onRetry={() => void statement.refetch()} />
          ) : statementEntries.length === 0 ? (
            <EmptyState icon={ScrollText} title="No ledger entries" description="Credits and payments will appear here." />
          ) : (
            <>
              <div className="flex flex-wrap justify-between gap-3 text-sm">
                <p>Opening balance: <Money kobo={statement.data.pages[0]?.openingBalanceKobo ?? "0"} /></p>
                <p>Closing balance: <Money kobo={statement.data.pages[0]?.closingBalanceKobo ?? "0"} /></p>
              </div>
              <ResponsiveTable rows={statementEntries} columns={ledgerColumns} getKey={(entry) => entry.id} />
              {statement.hasNextPage && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={statement.isFetchingNextPage}
                    onClick={() => void statement.fetchNextPage()}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    {statement.isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
