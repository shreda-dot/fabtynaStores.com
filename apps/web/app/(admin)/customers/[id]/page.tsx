"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatNaira } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/responsive-table";
import { customersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type {
  CustomerLedgerEntryDto,
  SaleDto,
} from "@fabtyna/shared";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const customer = useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => customersApi.getById(id),
  });

  if (customer.isPending) return <ListLoading />;
  if (customer.isError)
    return (
      <ListError
        message={customer.error.message || "Customer could not be loaded."}
        retry={() => void customer.refetch()}
      />
    );
  if (!customer.data) return <ListEmpty message="Customer not found." />;

  const c = customer.data;

  const totalPurchases = c.sales
    .filter((s) => s.status !== "VOIDED")
    .reduce((sum, s) => sum + BigInt(s.totalKobo), 0n);

  const ledgerColumns: ResponsiveTableColumn<CustomerLedgerEntryDto>[] = [
    {
      header: "Date",
      render: (entry) => new Date(entry.occurredAt).toLocaleDateString("en-NG"),
    },
    {
      header: "Type",
      render: (entry) => entry.type,
    },
    {
      header: "Amount",
      render: (entry) => (
        <span className={entry.amountKobo.startsWith("-") ? "text-destructive" : ""}>
          {formatNaira(entry.amountKobo)}
        </span>
      ),
    },
    {
      header: "Note",
      render: (entry) => entry.note ?? "—",
    },
  ];

  const saleColumns: ResponsiveTableColumn<SaleDto>[] = [
    {
      header: "Date",
      render: (sale) => new Date(sale.soldAt).toLocaleDateString("en-NG"),
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
      render: (sale) => formatNaira(sale.totalKobo),
    },
    {
      header: "Status",
      render: (sale) => sale.status,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/customers"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.type} · {c.phone ?? "No phone"} · {c.email ?? "no email"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total purchases</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(totalPurchases.toString())}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Balance owed</p>
          <p
            className={`mt-1 text-xl font-semibold ${
              BigInt(c.balanceOwedKobo) > 0n ? "text-destructive" : ""
            }`}
          >
            {formatNaira(c.balanceOwedKobo)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Credit limit</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(c.creditLimitKobo)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Address</p>
          <p className="mt-1 text-sm">{c.address ?? "—"}</p>
        </div>
      </div>

      {c.notes && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm">{c.notes}</p>
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Sales</h2>
        {c.sales.length === 0 ? (
          <ListEmpty message="No sales for this customer yet." />
        ) : (
          <ResponsiveTable
            rows={c.sales}
            columns={saleColumns}
            getKey={(sale) => sale.id}
          />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Ledger</h2>
        {c.ledgerEntries.length === 0 ? (
          <ListEmpty message="No ledger entries for this customer yet." />
        ) : (
          <ResponsiveTable
            rows={c.ledgerEntries}
            columns={ledgerColumns}
            getKey={(entry) => entry.id}
          />
        )}
      </section>
    </div>
  );
}
