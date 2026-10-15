"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  formatNaira,
  getLagosBusinessDate,
  type CreateSaleDto,
  type ProductDto,
  type StockLocation,
  type Unit,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { customersApi, productsApi, salesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type SaleChannelForSale = "RETAIL" | "WHOLESALE";

type SaleLineDraft = {
  id: string;
  productId: string;
  quantity: string;
  unitPriceKobo: string;
};

let lineCounter = 0;
function newLineId(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

export default function NewSalePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [channel, setChannel] = useState<SaleChannelForSale>("RETAIL");
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState<string>("");
  const [soldAt, setSoldAt] = useState<string>(() => getLagosBusinessDate());
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [paidKobo, setPaidKobo] = useState<string>("0");
  const [lines, setLines] = useState<SaleLineDraft[]>([
    {
      id: newLineId(),
      productId: "",
      quantity: "",
      unitPriceKobo: "",
    },
  ]);

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });
  const customersQuery = useQuery({
    queryKey: queryKeys.customers.list("", false),
    queryFn: () => customersApi.list({ search: "", includeDeleted: false }),
  });

  const productById = useMemo(() => {
    const map = new Map<string, ProductDto>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product);
    }
    return map;
  }, [productsQuery.data]);

  const location: StockLocation =
    channel === "RETAIL" ? "RETAIL_SHELF" : "WAREHOUSE";
  const defaultUnit: Unit = channel === "RETAIL" ? "UNIT" : "PACK";

  const channelCustomers = useMemo(() => {
    return (customersQuery.data ?? []).filter((c) => c.type === channel);
  }, [customersQuery.data, channel]);

  function lineTotalKobo(line: SaleLineDraft): bigint {
    const qty = Number(line.quantity);
    const price = line.unitPriceKobo;
    if (!Number.isFinite(qty) || qty <= 0 || !/^[0-9]+$/.test(price)) return 0n;
    return BigInt(qty) * BigInt(price);
  }

  const totalKobo = lines.reduce((sum, line) => sum + lineTotalKobo(line), 0n);

  const createMutation = useMutation({
    mutationFn: (input: CreateSaleDto) => salesApi.create(input),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      router.push(`/sales/${sale.id}`);
    },
  });

  function updateLine(id: string, patch: Partial<SaleLineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function onProductChange(id: string, productId: string) {
    const product = productById.get(productId);
    const defaultPrice =
      channel === "RETAIL"
        ? product?.retailPriceKobo
        : product?.wholesalePriceKobo;
    updateLine(id, {
      productId,
      unitPriceKobo: defaultPrice ?? "",
    });
  }

  function addLine() {
    setLines((prev) => [
      {
        id: newLineId(),
        productId: "",
        quantity: "",
        unitPriceKobo: "",
      },
      ...prev, // Prepend new lines to the top of the list
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
          /^[0-9]+$/.test(line.unitPriceKobo),
      )
      .map((line) => ({
        productId: line.productId,
        unit: defaultUnit,
        quantity: Number(line.quantity),
        unitPriceKobo: line.unitPriceKobo,
      }));

    if (validLines.length === 0) {
      createMutation.reset();
      return;
    }

    const input: CreateSaleDto = {
      customerId:
        channel === "WHOLESALE" && customerId !== "" ? customerId : null,
      customerName:
        channel === "RETAIL" && customerName.trim() !== ""
          ? customerName.trim()
          : null,
      channel,
      location,
      soldAt: new Date(soldAt).toISOString(),
      notes: notes.trim() === "" ? null : notes.trim(),
      reference: reference.trim() === "" ? null : reference.trim(),
      paidKobo,
      lines: validLines,
    };

    createMutation.mutate(input);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/sales"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            New sale
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Record a retail (fridge) or wholesale sale.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                Channel
              </label>
              <select
                value={channel}
                onChange={(event) => {
                  const next = event.target.value as SaleChannelForSale;
                  setChannel(next);
                  setCustomerId("");
                  setCustomerName("");
                  setLines((prev) =>
                    prev.map((line) => {
                      const product = productById.get(line.productId);
                      if (!product) return line;
                      const price =
                        next === "RETAIL"
                          ? product.retailPriceKobo
                          : product.wholesalePriceKobo;
                      return { ...line, unitPriceKobo: price };
                    }),
                  );
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="RETAIL">Retail (fridge) — per unit</option>
                <option value="WHOLESALE">Wholesale — per pack</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                Stock location
              </label>
              <input
                value={location.replace(/_/g, " ")}
                disabled
                className="h-9 w-full rounded-md border border-input bg-muted px-3 text-xs text-muted-foreground"
              />
            </div>

            {channel === "WHOLESALE" ? (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  Customer
                </label>
                <select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Walk-in (no customer)</option>
                  {channelCustomers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
                {channelCustomers.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No wholesale customers yet —{" "}
                    <Link
                      href="/customers"
                      className="text-primary hover:underline"
                    >
                      add one
                    </Link>
                    .
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  Debtor name (optional)
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="e.g. John — leave empty for walk-in"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Retail sales are general. Enter a name only if this customer
                  owes.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                Date
              </label>
              <input
                type="date"
                value={soldAt}
                onChange={(event) => setSoldAt(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-xs font-medium text-foreground">
                Reference
              </label>
              <input
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Receipt or invoice number"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Lines ({defaultUnit === "UNIT" ? "per unit" : "per pack"})
            </h2>
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
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground">
                        Product
                      </label>
                      <select
                        value={line.productId}
                        onChange={(event) =>
                          onProductChange(line.id, event.target.value)
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
                        Quantity ({defaultUnit === "UNIT" ? "units" : "crates"})
                      </label>
                      <input
                        type="number"
                        min={defaultUnit === "UNIT" ? 1 : 0.01}
                        step={defaultUnit === "UNIT" ? 1 : "any"}
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(line.id, { quantity: event.target.value })
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder={
                          defaultUnit === "UNIT"
                            ? "e.g. 6"
                            : "e.g. 0.5, 0.75, 1"
                        }
                      />
                      {defaultUnit === "PACK" && product && (
                        <p className="text-xs text-muted-foreground">
                          {Math.round(
                            Number(line.quantity || 0) * product.unitsPerPack,
                          )}{" "}
                          units
                        </p>
                      )}
                    </div>
                    <MoneyInput
                      id={`price-${line.id}`}
                      label={`Price per ${defaultUnit === "UNIT" ? "unit" : "pack"}`}
                      defaultValueKobo={line.unitPriceKobo}
                      onKoboChange={(value) =>
                        updateLine(line.id, { unitPriceKobo: value })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1 text-xs">
                    <span className="text-muted-foreground">
                      {product
                        ? `${product.packName} — ${product.unitsPerPack} units/pack`
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

        <div className="flex flex-col gap-4 bg-card p-4 rounded-xl border border-border/60 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <MoneyInput
              id="paid"
              label="Amount received"
              defaultValueKobo={paidKobo}
              onKoboChange={(value) => setPaidKobo(value)}
            />
            <div className="text-left sm:text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold text-foreground">
                {formatNaira(totalKobo.toString())}
              </p>
            </div>
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
            {createMutation.isPending ? "Recording…" : "Record sale"}
          </button>
        </div>
      </form>
    </div>
  );
}
