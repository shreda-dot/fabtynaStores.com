"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Receipt, ScrollText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDate } from "@fabtyna/shared";
import type { CustomerLedgerEntryDto, SaleDto } from "@fabtyna/shared";
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
import { ApiError, toTechnicalDetail, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const customer = useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => customersApi.getById(id),
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
            <Link
              href="/customers"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Back to customers
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        message={toUserMessage(customer.error)}
        detail={
          process.env.NODE_ENV === "development"
            ? toTechnicalDetail(customer.error)
            : undefined
        }
        onRetry={() => void customer.refetch()}
      />
    );
  }

  const c = customer.data;

  // Newest first so a long sales history is easy to scan by date.
  const salesByDate = [...c.sales].sort(
    (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime(),
  );
  const ledgerByDate = [...c.ledgerEntries].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const totalPurchases = c.sales
    .filter((s) => s.status !== "VOIDED")
    .reduce((sum, s) => sum + BigInt(s.totalKobo), 0n);

  const ledgerColumns: ResponsiveTableColumn<CustomerLedgerEntryDto>[] = [
    {
      header: "Date",
      render: (entry) => formatLagosDate(entry.occurredAt),
    },
    {
      header: "Type",
      render: (entry) => entry.type,
    },
    {
      header: "Amount",
      align: "right",
      render: (entry) => <Money kobo={entry.amountKobo} />,
    },
    {
      header: "Note",
      render: (entry) => entry.note ?? "—",
    },
  ];

  const saleColumns: ResponsiveTableColumn<SaleDto>[] = [
    {
      header: "Date",
      render: (sale) => formatLagosDate(sale.soldAt),
    },
    {
      header: "Channel",
      render: (sale) =>
        sale.channel === "RETAIL" ? "Retail (fridge)" : "Wholesale",
    },
    {
      header: "Reference",
      render: (sale) => (
        <Link
          href={`/sales/${sale.id}`}
          className="text-primary hover:underline"
        >
          {sale.reference ?? sale.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Total",
      align: "right",
      render: (sale) => <Money kobo={sale.totalKobo} tone="neutral" />,
    },
    {
      header: "Paid",
      align: "right",
      render: (sale) => <Money kobo={sale.paidKobo} tone="neutral" />,
    },
    {
      header: "Unpaid",
      align: "right",
      render: (sale) => {
        if (sale.status === "VOIDED") return "—";
        const owed = BigInt(sale.totalKobo) - BigInt(sale.paidKobo);
        return (
          <Money kobo={owed} className={owed > 0n ? "text-danger" : undefined} />
        );
      },
    },
    {
      header: "Status",
      align: "center",
      render: (sale) => <StatusBadge status={sale.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={`${c.type} · ${c.phone ?? "No phone"} · ${c.email ?? "no email"}`}
        actions={
          <Link
            href="/customers"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to customers
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total purchases"
          value={<Money kobo={totalPurchases} tone="neutral" />}
        />
        <StatCard
          label="Balance owed"
          value={<Money kobo={c.balanceOwedKobo} tone="auto" />}
          tone={BigInt(c.balanceOwedKobo) > 0n ? "danger" : "default"}
          hint={
            BigInt(c.balanceOwedKobo) > 0n
              ? "Outstanding on credit sales"
              : "Nothing outstanding"
          }
        />
        <StatCard
          label="Credit limit"
          value={<Money kobo={c.creditLimitKobo} tone="neutral" />}
        />
      </div>

      <Card>
        <CardHeader title="Contact" />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Type</dt>
              <dd className="mt-0.5 text-sm">{c.type}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Phone</dt>
              <dd className="mt-0.5 text-sm">{c.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="mt-0.5 text-sm">{c.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Address</dt>
              <dd className="mt-0.5 text-sm">{c.address ?? "—"}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {c.notes && (
        <Card>
          <CardHeader title="Notes" />
          <CardBody>
            <p className="text-sm text-muted-foreground">{c.notes}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Sales" />
        <CardBody>
          {salesByDate.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No sales yet"
              description="Sales for this customer will appear here."
            />
          ) : (
            <ResponsiveTable
              rows={salesByDate}
              columns={saleColumns}
              getKey={(sale) => sale.id}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Ledger" />
        <CardBody>
          {ledgerByDate.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No ledger entries yet"
              description="Credit and payment activity will appear here."
            />
          ) : (
            <ResponsiveTable
              rows={ledgerByDate}
              columns={ledgerColumns}
              getKey={(entry) => entry.id}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
