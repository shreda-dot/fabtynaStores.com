"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDate, formatNaira } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { suppliersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SupplierLedgerEntryDto, PurchaseDto } from "@fabtyna/shared";

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const supplier = useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => suppliersApi.getById(id),
  });

  if (supplier.isPending) return <ListLoading />;
  if (supplier.isError)
    return (
      <ListError
        message={supplier.error.message || "Supplier could not be loaded."}
        retry={() => void supplier.refetch()}
      />
    );
  if (!supplier.data) return <ListEmpty message="Supplier not found." />;

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
      render: (entry) => (
        <span
          className={entry.amountKobo.startsWith("-") ? "text-destructive" : ""}
        >
          {formatNaira(entry.amountKobo)}
        </span>
      ),
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
      render: (purchase) => formatNaira(purchase.totalKobo),
    },
    {
      header: "Status",
      render: (purchase) => purchase.status,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/suppliers"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.phone ?? "No phone"} · {s.email ?? "no email"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Balance owed</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(s.balanceOwedKobo)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Address</p>
          <p className="mt-1 text-sm">{s.address ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm">{s.notes ?? "—"}</p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Supplier payments are recorded in the Money phase.
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Purchases</h2>
        {purchasesByDate.length === 0 ? (
          <ListEmpty message="No purchases from this supplier yet." />
        ) : (
          <ResponsiveTable
            rows={purchasesByDate}
            columns={purchaseColumns}
            getKey={(purchase) => purchase.id}
          />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Ledger</h2>
        {ledgerByDate.length === 0 ? (
          <ListEmpty message="No ledger entries for this supplier yet." />
        ) : (
          <ResponsiveTable
            rows={ledgerByDate}
            columns={ledgerColumns}
            getKey={(entry) => entry.id}
          />
        )}
      </section>
    </div>
  );
}
