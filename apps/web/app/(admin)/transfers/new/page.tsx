"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  formatStockUnits,
  getLagosBusinessDate,
  type StockLocation,
} from "@fabtyna/shared";
import { productsApi, stockApi, transfersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type TransferLineDraft = {
  id: string;
  productId: string;
  quantityUnits: string;
};

let lineCounter = 0;
function newLineId(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

const LOCATIONS: StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export default function NewTransferPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [from, setFrom] = useState<StockLocation>("WAREHOUSE");
  const [to, setTo] = useState<StockLocation>("RETAIL_SHELF");
  const [reason, setReason] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [transferredAt, setTransferredAt] = useState<string>(() =>
    getLagosBusinessDate(),
  );
  const [lines, setLines] = useState<TransferLineDraft[]>([
    { id: newLineId(), productId: "", quantityUnits: "" },
  ]);

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });
  const stockQuery = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data ?? []) {
      map.set(row.productId, row.totalUnits);
    }
    return map;
  }, [stockQuery.data]);

  const productById = useMemo(() => {
    const map = new Map<
      string,
      { unitsPerPack: number; packName: string; name: string }
    >();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, {
        unitsPerPack: product.unitsPerPack,
        packName: product.packName,
        name: product.name,
      });
    }
    return map;
  }, [productsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (input: {
      from: StockLocation;
      to: StockLocation;
      reason: string | null;
      reference: string | null;
      transferredAt: string;
      lines: { productId: string; quantityUnits: number }[];
    }) =>
      transfersApi.create({
        from: input.from,
        to: input.to,
        reason: input.reason,
        reference: input.reference,
        transferredAt: input.transferredAt,
        lines: input.lines,
      }),
    onSuccess: (transfer) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      router.push(`/transfers/${transfer.id}`);
    },
  });

  function updateLine(id: string, patch: Partial<TransferLineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { id: newLineId(), productId: "", quantityUnits: "" },
    ]);
  }

  function removeLine(id: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((line) => line.id !== id) : prev,
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (from === to) {
      createMutation.reset();
      return;
    }
    const validLines = lines
      .filter(
        (line) =>
          line.productId !== "" &&
          Number.isFinite(Number(line.quantityUnits)) &&
          Number(line.quantityUnits) > 0,
      )
      .map((line) => ({
        productId: line.productId,
        quantityUnits: Number(line.quantityUnits),
      }));

    if (validLines.length === 0) {
      createMutation.reset();
      return;
    }

    createMutation.mutate({
      from,
      to,
      reason: reason.trim() === "" ? null : reason.trim(),
      reference: reference.trim() === "" ? null : reference.trim(),
      transferredAt: createLagosDateTime(transferredAt).toISOString(),
      lines: validLines,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/transfers"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            New transfer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Move stock between locations.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="from" className="block text-sm font-medium">
                From
              </label>
              <select
                id="from"
                value={from}
                onChange={(event) =>
                  setFrom(event.target.value as StockLocation)
                }
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="to" className="block text-sm font-medium">
                To
              </label>
              <select
                id="to"
                value={to}
                onChange={(event) => setTo(event.target.value as StockLocation)}
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="date" className="block text-sm font-medium">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={transferredAt}
                onChange={(event) => setTransferredAt(event.target.value)}
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reason" className="block text-sm font-medium">
              Reason
            </label>
            <input
              id="reason"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional"
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reference" className="block text-sm font-medium">
              Reference
            </label>
            <input
              id="reference"
              type="text"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Auto-generated if left blank"
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            />
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Lines</h2>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add line
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const available = stockByProduct.get(line.productId) ?? 0;
              return (
                <div
                  key={line.id}
                  className="space-y-3 rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Line {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length === 1}
                      className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-destructive hover:bg-muted disabled:opacity-40"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium">
                        Product
                      </label>
                      <select
                        value={line.productId}
                        onChange={(event) =>
                          updateLine(line.id, { productId: event.target.value })
                        }
                        className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                      >
                        <option value="">Select product</option>
                        {productsQuery.data?.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium">
                        Quantity (units)
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantityUnits}
                        onChange={(event) =>
                          updateLine(line.id, {
                            quantityUnits: event.target.value,
                          })
                        }
                        className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                        placeholder="e.g. 12"
                      />
                    </div>
                  </div>
                  {product && (
                    <p className="text-xs text-muted-foreground">
                      Available at {from.replace(/_/g, " ")}:{" "}
                      {formatStockUnits(
                        available,
                        product.unitsPerPack,
                        product.packName,
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {createMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
          {from === to && (
            <p role="alert" className="text-sm text-destructive">
              From and to locations must be different.
            </p>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending || from === to}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {createMutation.isPending ? "Transferring…" : "Transfer"}
          </button>
        </div>
      </form>
    </div>
  );
}
