"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatNaira } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { salesApi } from "@/lib/api";
import type { SaleLineWithProductDto } from "@/lib/api/sales.api";
import { queryKeys } from "@/lib/query-keys";

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = params.id;

  const sale = useQuery({
    queryKey: queryKeys.sales.detail(id),
    queryFn: () => salesApi.getById(id),
  });

  const voidMutation = useMutation({
    mutationFn: () => salesApi.void(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });

  function tryVoid() {
    if (sale.data?.status === "VOIDED") return;
    if (
      !window.confirm(
        "Void this sale? Stock will be returned and any customer balance will be reversed. This cannot be undone.",
      )
    ) {
      return;
    }
    voidMutation.mutate();
  }

  const lineColumns: ResponsiveTableColumn<SaleLineWithProductDto>[] = [
    {
      header: "Product",
      render: (line) => line.productName,
    },
    {
      header: "Unit",
      render: (line) => line.unit,
    },
    {
      header: "Quantity",
      render: (line) =>
        `${line.quantity} (${line.quantityUnits} units)`,
    },
    {
      header: "Unit price",
      render: (line) => formatNaira(line.unitPriceKobo),
    },
    {
      header: "Line total",
      render: (line) => formatNaira(line.lineTotalKobo),
    },
  ];

  if (sale.isPending) return <ListLoading />;
  if (sale.isError)
    return (
      <ListError
        message={sale.error.message || "Sale could not be loaded."}
        retry={() => void sale.refetch()}
      />
    );
  if (!sale.data) return <ListEmpty message="Sale not found." />;

  const s = sale.data;
  const unpaidKobo = BigInt(s.totalKobo) - BigInt(s.paidKobo);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/sales"
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Sale {s.reference ?? s.id.slice(0, 8)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(s.soldAt).toLocaleString("en-NG")} ·{" "}
              <span
                className={
                  s.status === "VOIDED"
                    ? "text-destructive"
                    : s.status === "COMPLETED"
                      ? "text-green-700 dark:text-green-400"
                      : ""
                }
              >
                {s.status}
              </span>
            </p>
          </div>
        </div>
        {s.status !== "VOIDED" && (
          <button
            type="button"
            onClick={tryVoid}
            disabled={voidMutation.isPending}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {voidMutation.isPending ? "Voiding…" : "Void sale"}
          </button>
        )}
      </div>

      {voidMutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
        >
          <p className="font-medium">Cannot void this sale</p>
          <p className="mt-1">{voidMutation.error.message}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Channel</p>
          <p className="mt-1 font-medium">
            {s.channel === "RETAIL" ? "Retail (fridge)" : "Wholesale"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Customer</p>
          <p className="mt-1 font-medium">
            {s.customer?.name ?? s.customerName ?? "Walk-in"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="mt-1 font-medium">{formatNaira(s.totalKobo)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Paid</p>
          <p className="mt-1 font-medium">{formatNaira(s.paidKobo)}</p>
        </div>
        {unpaidKobo > 0n && (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Unpaid</p>
            <p className="mt-1 font-medium text-destructive">
              {formatNaira(unpaidKobo.toString())}
            </p>
          </div>
        )}
      </div>

      {s.notes && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm">{s.notes}</p>
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Lines</h2>
        <ResponsiveTable
          rows={s.lines}
          columns={lineColumns}
          getKey={(line) => line.id}
        />
      </section>

      {s.payments.length > 0 && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Payment history</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.payments.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="py-2 pr-4">
                    {new Date(p.paidAt).toLocaleString("en-NG")}
                  </td>
                  <td className="py-2 pr-4 font-medium text-green-700 dark:text-green-400">
                    {formatNaira(p.amountKobo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Stock movements</h2>
        {s.movements.length === 0 ? (
          <ListEmpty message="No stock movements recorded." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Location</th>
                <th className="py-2 pr-4 font-medium">Units</th>
              </tr>
            </thead>
            <tbody>
              {s.movements.map((m) => (
                <tr key={m.id} className="border-b border-border/50">
                  <td className="py-2 pr-4">{m.productId.slice(0, 8)}</td>
                  <td className="py-2 pr-4">{m.location.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{m.quantityUnits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
