"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  formatNaira,
  getLagosBusinessDate,
  type CreatePurchaseDto,
  type ProductDto,
  type StockLocation,
  type Unit,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { productsApi, purchasesApi, suppliersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type PurchaseLineDraft = {
  id: string;
  productId: string;
  unit: Unit;
  quantity: string;
  pricePerUnitKobo: string;
};

let lineCounter = 0;
function newLineId(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

const LOCATIONS: StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export default function NewPurchasePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>("");
  const [location, setLocation] = useState<StockLocation>("WAREHOUSE");
  const [purchasedAt, setPurchasedAt] = useState<string>(() =>
    getLagosBusinessDate(),
  );
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [lines, setLines] = useState<PurchaseLineDraft[]>([
    {
      id: newLineId(),
      productId: "",
      unit: "PACK",
      quantity: "",
      pricePerUnitKobo: "",
    },
  ]);

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });
  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers.list("", false),
    queryFn: () => suppliersApi.list({ search: "", includeDeleted: false }),
  });

  const productById = useMemo(() => {
    const map = new Map<string, ProductDto>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product);
    }
    return map;
  }, [productsQuery.data]);

  function lineTotalKobo(line: PurchaseLineDraft): bigint {
    const qty = Number(line.quantity);
    const price = line.pricePerUnitKobo;
    if (!Number.isFinite(qty) || qty <= 0 || !/^[0-9]+$/.test(price)) return 0n;
    return BigInt(qty) * BigInt(price);
  }

  const totalKobo = lines.reduce((sum, line) => sum + lineTotalKobo(line), 0n);

  const createMutation = useMutation({
    mutationFn: (input: CreatePurchaseDto) => purchasesApi.create(input),
    onSuccess: (purchase) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      router.push(`/purchases/${purchase.id}`);
    },
  });

  function updateLine(id: string, patch: Partial<PurchaseLineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [
      {
        id: newLineId(),
        productId: "",
        unit: "PACK",
        quantity: "",
        pricePerUnitKobo: "",
      },
      ...prev, // Prepend to the top of the list instead of appending
    ]);
  }

  function removeLine(id: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((line) => line.id !== id) : prev,
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const validLines = lines
      .filter(
        (line) =>
          line.productId !== "" &&
          Number.isFinite(Number(line.quantity)) &&
          Number(line.quantity) > 0 &&
          /^[0-9]+$/.test(line.pricePerUnitKobo),
      )
      .map((line) => {
        const product = productById.get(line.productId);
        if (!product) throw new Error("Product not found.");
        const qty = Number(line.quantity);
        const lineTotal = lineTotalKobo(line).toString();
        return {
          productId: line.productId,
          unit: line.unit,
          quantity: qty,
          lineTotalKobo: lineTotal,
        };
      });

    if (validLines.length === 0) {
      createMutation.reset();
      return;
    }

    const input: CreatePurchaseDto = {
      supplierId: supplierId === "" ? null : supplierId,
      location,
      purchasedAt: createLagosDateTime(purchasedAt).toISOString(),
      notes: notes.trim() === "" ? null : notes.trim(),
      reference: reference.trim() === "" ? null : reference.trim(),
      lines: validLines,
    };

    createMutation.mutate(input);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/purchases"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            New purchase
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Receive goods into stock.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="supplier"
                className="block text-xs font-medium text-foreground"
              >
                Supplier (optional)
              </label>
              <select
                id="supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No supplier</option>
                {suppliersQuery.data?.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="location"
                className="block text-xs font-medium text-foreground"
              >
                Receiving location
              </label>
              <select
                id="location"
                value={location}
                onChange={(event) =>
                  setLocation(event.target.value as StockLocation)
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="date"
                className="block text-xs font-medium text-foreground"
              >
                Date
              </label>
              <input
                id="date"
                type="date"
                value={purchasedAt}
                onChange={(event) => setPurchasedAt(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="reference"
                className="block text-xs font-medium text-foreground"
              >
                Reference
              </label>
              <input
                id="reference"
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Invoice or GRN number"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="notes"
              className="block text-xs font-medium text-foreground"
            >
              Notes
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Lines</h2>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              Add line
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const unitsPerPack = product?.unitsPerPack ?? 24;
              const qty = Number(line.quantity);
              const quantityUnits =
                line.unit === "PACK" && Number.isFinite(qty) && qty > 0
                  ? qty * unitsPerPack
                  : qty;
              const total = lineTotalKobo(line);
              return (
                <div
                  key={line.id}
                  className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Line {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length === 1}
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">
                        Product
                      </label>
                      <select
                        value={line.productId}
                        onChange={(event) =>
                          updateLine(line.id, { productId: event.target.value })
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                      <label className="block text-xs font-medium text-foreground">
                        Unit
                      </label>
                      <select
                        value={line.unit}
                        onChange={(event) =>
                          updateLine(line.id, {
                            unit: event.target.value as Unit,
                          })
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="PACK">
                          Pack ({unitsPerPack} units)
                        </option>
                        <option value="UNIT">Single unit</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">
                        Quantity
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(line.id, { quantity: event.target.value })
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder="e.g. 2"
                      />
                    </div>
                    <MoneyInput
                      id={`price-${line.id}`}
                      label={`Price per ${line.unit === "PACK" ? "pack" : "unit"}`}
                      defaultValueKobo={line.pricePerUnitKobo}
                      onKoboChange={(value) =>
                        updateLine(line.id, { pricePerUnitKobo: value })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">
                      {Number.isFinite(quantityUnits) && quantityUnits > 0
                        ? `${quantityUnits} units`
                        : "—"}
                    </span>
                    <span className="font-medium text-foreground">
                      Line total: {formatNaira(total.toString())}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-card p-4 rounded-xl border border-border/60 shadow-sm">
          <div className="text-left sm:text-right w-full sm:w-auto">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold text-foreground">
              {formatNaira(totalKobo.toString())}
            </p>
          </div>
          {createMutation.error && (
            <p role="alert" className="text-xs text-destructive">
              {createMutation.error.message}
            </p>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 w-full sm:w-auto"
          >
            {createMutation.isPending ? "Receiving…" : "Receive"}
          </button>
        </div>
      </form>
    </div>
  );
}
