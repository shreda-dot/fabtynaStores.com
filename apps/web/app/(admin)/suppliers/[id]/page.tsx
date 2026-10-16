"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, PackageSearch, ScrollText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDate } from "@fabtyna/shared";
import type { PurchaseDto, SupplierLedgerEntryDto } from "@fabtyna/shared";
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
import { ApiError, toTechnicalDetail, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const supplier = useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => suppliersApi.getById(id),
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
            <Link
              href="/suppliers"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Back to suppliers
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        message={toUserMessage(supplier.error)}
        detail={
          process.env.NODE_ENV === "development"
            ? toTechnicalDetail(supplier.error)
            : undefined
        }
        onRetry={() => void supplier.refetch()}
      />
    );
  }

  const s = supplier.data;
  const purchasesByDate = [...s.purchases].sort(
    (a, b) =>
      new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime(),
  );
  const ledgerByDate = [...s.ledgerEntries].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const ledgerColumns: ResponsiveTableColumn<SupplierLedgerEntryDto>[] = [
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

  const purchaseColumns: ResponsiveTableColumn<PurchaseDto>[] = [
    {
      header: "Date",
      render: (purchase) => formatLagosDate(purchase.purchasedAt),
    },
    {
      header: "Reference",
      render: (purchase) => (
        <Link
          href={`/purchases/${purchase.id}`}
          className="text-primary hover:underline"
        >
          {purchase.reference ?? purchase.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Total",
      align: "right",
      render: (purchase) => <Money kobo={purchase.totalKobo} tone="neutral" />,
    },
    {
      header: "Status",
      align: "center",
      render: (purchase) => <StatusBadge status={purchase.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.name}
        description={`${s.phone ?? "No phone"} · ${s.email ?? "no email"}`}
        actions={
          <Link
            href="/suppliers"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to suppliers
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Balance owed" value={<Money kobo={s.balanceOwedKobo} tone="auto" />} />
        <StatCard label="Purchases" value={s.purchases.length} />
        <StatCard label="Ledger entries" value={s.ledgerEntries.length} />
      </div>

      <Card>
        <CardHeader title="Contact" />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Phone</dt>
              <dd className="mt-0.5 text-sm">{s.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="mt-0.5 text-sm">{s.email ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Address</dt>
              <dd className="mt-0.5 text-sm">{s.address ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 text-sm">{s.notes ?? "—"}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Supplier payments are recorded in the Money phase.</p>
      </div>

      <Card>
        <CardHeader title="Purchases" />
        <CardBody>
          {purchasesByDate.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="No purchases yet"
              description="Purchases from this supplier will appear here."
            />
          ) : (
            <ResponsiveTable
              rows={purchasesByDate}
              columns={purchaseColumns}
              getKey={(purchase) => purchase.id}
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
              description="Purchase and payment activity will appear here."
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
