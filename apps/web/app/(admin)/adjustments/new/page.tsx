"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  getLagosBusinessDate,
  type StockLocation,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { adjustmentsApi, productsApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type AdjustmentLineDraft = {
  id: string;
  productId: string;
  location: StockLocation;
  quantityDeltaUnits: string;
  unitCostKobo: string;
};

let lineCounter = 0;
function newLineId(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

const LOCATIONS: StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export default function NewAdjustmentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState<string>("");
  const [adjustedAt, setAdjustedAt] = useState<string>(() =>
    getLagosBusinessDate(),
  );
  const [lines, setLines] = useState<AdjustmentLineDraft[]>([
    {
      id: newLineId(),
      productId: "",
      location: "WAREHOUSE",
      quantityDeltaUnits: "",
      unitCostKobo: "",
    },
  ]);

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      reason: string;
      adjustedAt: string;
      lines: {
        productId: string;
        location: StockLocation;
        quantityDeltaUnits: number;
        unitCostKobo?: string;
      }[];
    }) =>
      adjustmentsApi.create({
        reason: input.reason,
        adjustedAt: input.adjustedAt,
        lines: input.lines,
      }),
    onSuccess: (adjustment) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adjustments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      router.push(`/adjustments/${adjustment.id}`);
    },
  });

  function updateLine(id: string, patch: Partial<AdjustmentLineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: newLineId(),
        productId: "",
        location: "WAREHOUSE",
        quantityDeltaUnits: "",
        unitCostKobo: "",
      },
    ]);
  }

  function removeLine(id: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((line) => line.id !== id) : prev,
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim() === "") return;

    const validLines = lines
      .filter(
        (line) =>
          line.productId !== "" &&
          Number.isFinite(Number(line.quantityDeltaUnits)) &&
          Number(line.quantityDeltaUnits) !== 0,
      )
      .map((line) => {
        const delta = Number(line.quantityDeltaUnits);
        const base: {
          productId: string;
          location: StockLocation;
          quantityDeltaUnits: number;
          unitCostKobo?: string;
        } = {
          productId: line.productId,
          location: line.location,
          quantityDeltaUnits: delta,
        };
        if (delta > 0 && /^[0-9]+$/.test(line.unitCostKobo)) {
          base.unitCostKobo = line.unitCostKobo;
        }
        return base;
      });

    if (validLines.length === 0) return;

    createMutation.mutate({
      reason: reason.trim(),
      adjustedAt: createLagosDateTime(adjustedAt).toISOString(),
      lines: validLines,
    });
  }

  return (
    <div className="space-y-6">
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
            New adjustment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Correct stock counts. Use positive for found stock, negative for
            lost or damaged.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="reason" className="block text-sm font-medium">
                Reason
              </label>
              <input
                id="reason"
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Damaged stock, found extra"
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="date" className="block text-sm font-medium">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={adjustedAt}
                onChange={(event) => setAdjustedAt(event.target.value)}
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </div>
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
              const delta = Number(line.quantityDeltaUnits);
              const isPositive = Number.isFinite(delta) && delta > 0;
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
                        Location
                      </label>
                      <select
                        value={line.location}
                        onChange={(event) =>
                          updateLine(line.id, {
                            location: event.target.value as StockLocation,
                          })
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
                      <label className="block text-sm font-medium">
                        Quantity delta (units)
                      </label>
                      <input
                        type="number"
                        step={1}
                        value={line.quantityDeltaUnits}
                        onChange={(event) =>
                          updateLine(line.id, {
                            quantityDeltaUnits: event.target.value,
                          })
                        }
                        className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                        placeholder="positive for add, negative for remove"
                      />
                    </div>
                    {isPositive && (
                      <MoneyInput
                        id={`cost-${line.id}`}
                        label="Unit cost (for positive delta)"
                        defaultValueKobo={line.unitCostKobo}
                        onKoboChange={(value) =>
                          updateLine(line.id, { unitCostKobo: value })
                        }
                      />
                    )}
                  </div>
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
          <button
            type="submit"
            disabled={createMutation.isPending || reason.trim() === ""}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {createMutation.isPending ? "Saving…" : "Save adjustment"}
          </button>
        </div>
      </form>
    </div>
  );
}
