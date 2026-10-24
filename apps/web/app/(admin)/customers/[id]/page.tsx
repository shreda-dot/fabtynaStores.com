"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Receipt, ScrollText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDate } from "@fabtyna/shared";
import { CustomerSalesTotals } from "@/components/customers/customer-sales-totals";
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
import { customersApi } from "@/lib/api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import type {
  CustomerStatementEntryDto,
} from "@/lib/api/customers.api";
import { queryKeys } from "@/lib/query-keys";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const customer = useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => customersApi.getById(id),
  });
  const statement = useInfiniteQuery({
    queryKey: [...queryKeys.customers.detail(id), "statement"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      customersApi.getStatement(id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  if (customer.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" className="h-8 w-56" />
        <Skeleton variant="stat" count={3} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }
  if (customer.isError) {
    if (customer.error instanceof ApiError && customer.error.kind === "not-found") {
      return (
        <EmptyState
          title="Customer not found"
          description="This customer may have been removed, or the link is incorrect."
          action={
            <Link href="/customers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Back to customers
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        message={toUserMessage(customer.error)}
        onRetry={() => void customer.refetch()}
      />
    );
  }

  const profile = customer.data;
  const c = profile.customer;
  const recentSales = profile.recentSales;
  const unpaidSales = profile.unpaidSales;
  const statementEntries =
    statement.data?.pages.flatMap((page) => page.entries) ?? [];
  const ledgerColumns: ResponsiveTableColumn<CustomerStatementEntryDto>[] = [
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
  const saleColumns: ResponsiveTableColumn<(typeof recentSales)[number]>[] = [
    { header: "Date", render: (sale) => formatLagosDate(sale.soldAt) },
    {
      header: "Reference",
      render: (sale) => (
        <Link href={`/sales/${sale.id}`} className="text-primary hover:underline">
          {sale.reference ?? sale.id.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Total", align: "right", render: (sale) => <Money kobo={sale.totalKobo} /> },
    { header: "Paid", align: "right", render: (sale) => <Money kobo={sale.paidKobo} /> },
    { header: "Status", align: "center", render: (sale) => <StatusBadge status={sale.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={`${c.type} · ${c.phone ?? "No phone"} · ${c.email ?? "no email"}`}
        actions={
          <Link href="/customers" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to customers
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Balance owed"
          value={<Money kobo={profile.balanceOwedKobo} tone="auto" />}
          tone={BigInt(profile.balanceOwedKobo) > 0n ? "danger" : "default"}
        />
        <StatCard label="Credit limit" value={<Money kobo={c.creditLimitKobo} tone="neutral" />} />
        <StatCard label="Unpaid sales" value={unpaidSales.length} />
      </div>
      <CustomerSalesTotals customerId={id} />
      <Card>
        <CardHeader title="Contact" />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">Type</dt><dd>{c.type}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Phone</dt><dd>{c.phone ?? "—"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Email</dt><dd>{c.email ?? "—"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Address</dt><dd>{c.address ?? "—"}</dd></div>
            {c.notes && <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Notes</dt><dd>{c.notes}</dd></div>}
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Outstanding sales" description="Aging is calculated from Lagos business dates." />
        <CardBody>
          {unpaidSales.length === 0 ? (
            <EmptyState icon={Receipt} title="No unpaid sales" description="This customer has no outstanding sales." />
          ) : (
            <div className="space-y-3">
              {unpaidSales.map((sale) => (
                <div key={sale.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <Link href={`/sales/${sale.id}`} className="font-medium text-primary hover:underline">
                      {sale.reference ?? sale.id.slice(0, 8)}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {formatLagosDate(sale.soldAt)} · {sale.daysOutstanding} days outstanding
                    </p>
                  </div>
                  <Money kobo={sale.balanceDueKobo} tone="auto" />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent sales" description="The API profile includes the 10 most recent sales." />
        <CardBody>
          {recentSales.length === 0 ? (
            <EmptyState icon={Receipt} title="No sales yet" description="Sales for this customer will appear here." />
          ) : (
            <ResponsiveTable rows={recentSales} columns={saleColumns} getKey={(sale) => sale.id} />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Ledger statement" description="All available customer ledger history." />
        <CardBody className="space-y-4">
          {statement.isPending ? (
            <Skeleton variant="row" count={4} />
          ) : statement.isError ? (
            <ErrorState message={toUserMessage(statement.error)} onRetry={() => void statement.refetch()} />
          ) : statementEntries.length === 0 ? (
            <EmptyState icon={ScrollText} title="No ledger entries" description="Credit and payment activity will appear here." />
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