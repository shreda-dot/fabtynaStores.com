"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDateTime, formatStockUnits } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { productsApi, transfersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const transfer = useQuery({
    queryKey: queryKeys.transfers.detail(id),
    queryFn: () => transfersApi.getById(id),
  });

  const products = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });

  const unitsPerPackById = new Map(
    (products.data ?? []).map((p) => [p.id, p.unitsPerPack]),
  );
  const packNameById = new Map(
    (products.data ?? []).map((p) => [p.id, p.packName]),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/transfers"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Transfer details
          </h1>
        </div>
      </div>

      {transfer.isPending ? (
        <ListLoading />
      ) : transfer.isError ? (
        <ListError
          message={transfer.error.message || "Transfer could not be loaded."}
          retry={() => void transfer.refetch()}
        />
      ) : !transfer.data ? (
        <ListEmpty message="Transfer not found." />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5">
            <div>
              <p className="text-xs text-muted-foreground">Reference</p>
              <p className="mt-1 font-medium">
                {transfer.data.reference ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">From</p>
              <p className="mt-1 font-medium">
                {transfer.data.from.replace(/_/g, " ")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">To</p>
              <p className="mt-1 font-medium">
                {transfer.data.to.replace(/_/g, " ")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="mt-1 font-medium">
                {formatLagosDateTime(transfer.data.transferredAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Reason</p>
              <p className="mt-1 font-medium">{transfer.data.reason ?? "—"}</p>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Items transferred</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Product</th>
                    <th className="py-2 pr-4 font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {transfer.data.lines.map((line) => {
                    const unitsPerPack = unitsPerPackById.get(line.productId);
                    const packName = packNameById.get(line.productId);
                    return (
                      <tr key={line.id} className="border-b border-border/60">
                        <td className="py-2 pr-4 font-medium">
                          {line.productName}
                        </td>
                        <td className="py-2 pr-4">
                          {unitsPerPack && packName
                            ? formatStockUnits(
                                line.quantityUnits,
                                unitsPerPack,
                                packName,
                              )
                            : `${line.quantityUnits} units`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
