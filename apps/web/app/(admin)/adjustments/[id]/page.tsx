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
import { adjustmentsApi } from "@/lib/api";
import type { AdjustmentLineWithProductDto } from "@/lib/api/adjustments.api";
import { queryKeys } from "@/lib/query-keys";

export default function AdjustmentDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = params.id;

  const adjustment = useQuery({
    queryKey: queryKeys.adjustments.detail(id),
    queryFn: () => adjustmentsApi.getById(id),
  });

  const voidMutation = useMutation({
    mutationFn: () => adjustmentsApi.void(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adjustments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
    },
  });

  function tryVoid() {
    if (adjustment.data?.status !== "COMPLETED") return;
    if (
      !window.confirm(
        "Void this adjustment? The stock movements will be reversed. This cannot be undone.",
      )
    ) {
      return;
    }
    voidMutation.mutate();
  }

  const lineColumns: ResponsiveTableColumn<AdjustmentLineWithProductDto>[] = [
    {
      header: "Product",
      render: (line) => line.productName,
    },
    {
      header: "Location",
      render: (line) => line.location.replace(/_/g, " "),
    },
    {
      header: "Delta",
      render: (line) =>
        line.quantityDeltaUnits > 0
          ? `+${line.quantityDeltaUnits}`
          : line.quantityDeltaUnits.toString(),
    },
    {
      header: "Unit cost",
      render: (line) => formatNaira(line.unitCostKobo),
    },
  ];

  if (adjustment.isPending) return <ListLoading />;
  if (adjustment.isError)
    return (
      <ListError
        message={adjustment.error.message || "Adjustment could not be loaded."}
        retry={() => void adjustment.refetch()}
      />
    );
  if (!adjustment.data) return <ListEmpty message="Adjustment not found." />;

  const a = adjustment.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/adjustments"
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Adjustment {a.id.slice(0, 8)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(a.adjustedAt).toLocaleDateString("en-NG")} ·{" "}
              <span className={a.status === "VOIDED" ? "text-destructive" : ""}>
                {a.status}
              </span>
            </p>
          </div>
        </div>
        {a.status === "COMPLETED" && (
          <button
            type="button"
            onClick={tryVoid}
            disabled={voidMutation.isPending}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {voidMutation.isPending ? "Voiding…" : "Void adjustment"}
          </button>
        )}
      </div>

      {voidMutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
        >
          <p className="font-medium">Cannot void this adjustment</p>
          <p className="mt-1">{voidMutation.error.message}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Reason</p>
        <p className="mt-1 font-medium">{a.reason}</p>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Lines</h2>
        <ResponsiveTable
          rows={a.lines}
          columns={lineColumns}
          getKey={(line) => line.id}
        />
      </section>
    </div>
  );
}
