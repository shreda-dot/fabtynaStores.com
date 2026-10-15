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
import { purchasesApi } from "@/lib/api";
import type { PurchaseLineWithProductDto } from "@/lib/api/purchases.api";
import { queryKeys } from "@/lib/query-keys";

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = params.id;

  const purchase = useQuery({
    queryKey: queryKeys.purchases.detail(id),
    queryFn: () => purchasesApi.getById(id),
  });

  const voidMutation = useMutation({
    mutationFn: () => purchasesApi.void(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
    },
  });

  function tryVoid() {
    if (purchase.data?.status !== "RECEIVED") return;
    if (
      !window.confirm(
        "Void this purchase? Stock movements and the supplier ledger entry will be reversed. This cannot be undone.",
      )
    ) {
      return;
    }
    voidMutation.mutate();
  }

  const columns: ResponsiveTableColumn<PurchaseLineWithProductDto>[] = [
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
      render: (line) => `${line.quantity} (${line.quantityUnits} units)`,
    },
    {
      header: "Unit cost",
      render: (line) => formatNaira(line.unitCostKobo),
    },
    {
      header: "Line total",
      render: (line) => formatNaira(line.lineTotalKobo),
    },
  ];

  if (purchase.isPending) return <ListLoading />;
  if (purchase.isError)
    return (
      <ListError
        message={purchase.error.message || "Purchase could not be loaded."}
        retry={() => void purchase.refetch()}
      />
    );
  if (!purchase.data) return <ListEmpty message="Purchase not found." />;

  const p = purchase.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/purchases"
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Purchase {p.reference ?? p.id.slice(0, 8)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(p.purchasedAt).toLocaleDateString("en-NG")} ·{" "}
              <span
                className={
                  p.status === "VOIDED"
                    ? "text-destructive"
                    : p.status === "RECEIVED"
                      ? "text-green-700 dark:text-green-400"
                      : ""
                }
              >
                {p.status}
              </span>
            </p>
          </div>
        </div>
        {p.status === "RECEIVED" && (
          <div className="flex items-center gap-2">
            <Link
              href={`/purchases/${p.id}/edit`}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Edit purchase
            </Link>
            <button
              type="button"
              onClick={tryVoid}
              disabled={voidMutation.isPending}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              {voidMutation.isPending ? "Voiding…" : "Void purchase"}
            </button>
          </div>
        )}
      </div>

      {voidMutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
        >
          <p className="font-medium">Cannot void this purchase</p>
          <p className="mt-1">{voidMutation.error.message}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Supplier</p>
          <p className="mt-1 font-medium">
            {p.supplier?.name ?? "No supplier"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Reference</p>
          <p className="mt-1 font-medium">{p.reference ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="mt-1 font-medium">{formatNaira(p.totalKobo)}</p>
        </div>
      </div>

      {p.notes && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm">{p.notes}</p>
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Lines</h2>
        <ResponsiveTable
          rows={p.lines}
          columns={columns}
          getKey={(line) => line.id}
        />
      </section>
    </div>
  );
}
