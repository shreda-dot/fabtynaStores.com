"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  getLagosBusinessDate,
  type CreateSaleDto,
  type PaymentMethod,
  type ProductDto,
  type StockLocation,
  type Unit,
} from "@fabtyna/shared";
import { QuickAddCustomerDialog } from "@/components/customers/quick-add-customer-dialog";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { MoneyInput } from "@/components/money-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { accountingApi, customersApi, productsApi, salesApi, stockApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

type SaleChannelForSale = "RETAIL" | "WHOLESALE";

type SaleLineDraft = {
  id: string;
  productId: string;
  quantity: string;
  unitPriceKobo: string;
};

export default function NewSalePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();

  const [channel, setChannel] = useState<SaleChannelForSale>("RETAIL");
  const [customerId, setCustomerId] = useState<string>("");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [soldAt, setSoldAt] = useState<string>(() => getLagosBusinessDate());
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [paidKobo, setPaidKobo] = useState<string>("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");
  const [lines, setLines] = useState<SaleLineDraft[]>([
    { id: `${uid}-0`, productId: "", quantity: "", unitPriceKobo: "" },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const lineSeq = useRef(1);
  const submitting = useRef(false);

  const network = useNetworkStatus();
  const businessDate = useLagosBusinessDate();

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });
  const customersQuery = useQuery({
    queryKey: queryKeys.customers.list("", false),
    queryFn: () => customersApi.list({ search: "", includeDeleted: false }),
  });
  const stockQuery = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });
  const accountsQuery = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });

  const productById = useMemo(() => {
    const map = new Map<string, ProductDto>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product);
    }
    return map;
  }, [productsQuery.data]);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of stockQuery.data ?? []) {
      const byLocation = new Map<string, number>();
      for (const breakdown of row.byLocation) {
        byLocation.set(breakdown.location, breakdown.quantityUnits);
      }
      map.set(row.productId, byLocation);
    }
    return map;
  }, [stockQuery.data]);

  const location: StockLocation =
    channel === "RETAIL" ? "RETAIL_SHELF" : "WAREHOUSE";
  const defaultUnit: Unit = channel === "RETAIL" ? "UNIT" : "PACK";

  const channelCustomers = useMemo(() => {
    return (customersQuery.data ?? []).filter((c) => c.type === channel);
  }, [customersQuery.data, channel]);

  function availableUnits(productId: string, loc: StockLocation): number {
    return stockByProduct.get(productId)?.get(loc) ?? 0;
  }

  function lineUnits(line: SaleLineDraft): number {
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    if (defaultUnit === "UNIT") return qty;
    const product = productById.get(line.productId);
    return qty * (product?.unitsPerPack ?? 1);
  }

  /**
   * Mirrors `recordSale` in the domain so the preview matches the saved total:
   * UNIT → quantity × unit price; PACK → round(quantity × unit price).
   */
  function lineTotalKobo(line: SaleLineDraft): bigint {
    const qty = Number(line.quantity);
    const price = line.unitPriceKobo;
    if (!Number.isFinite(qty) || qty <= 0 || !/^[0-9]+$/.test(price)) return 0n;
    const priceKobo = BigInt(price);
    if (defaultUnit === "UNIT") {
      if (!Number.isInteger(qty)) return 0n;
      return BigInt(qty) * priceKobo;
    }
    return BigInt(Math.round(qty * Number(priceKobo)));
  }

  const totalKobo = lines.reduce((sum, line) => sum + lineTotalKobo(line), 0n);
  const paid = /^[0-9]+$/.test(paidKobo) ? BigInt(paidKobo) : 0n;
  const balanceOwed = totalKobo - paid;

  const customersQueryFailed =
    productsQuery.isError ||
    customersQuery.isError ||
    stockQuery.isError ||
    (paid > 0n && accountsQuery.isError);

  const createMutation = useMutation({
    mutationFn: (input: CreateSaleDto) => salesApi.create(input),
    onSuccess: (sale) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      toast.success(
        `Sale recorded — ${sale.reference ?? sale.id.slice(0, 8)}.`,
      );
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
    updateLine(id, { productId, unitPriceKobo: defaultPrice ?? "" });
  }

  function newLineId(): string {
    const id = `${uid}-${lineSeq.current}`;
    lineSeq.current += 1;
    return id;
  }

  function addLine() {
    setLines((prev) => [
      {
        id: newLineId(),
        productId: "",
        quantity: "",
        unitPriceKobo: "",
      },
      ...prev,
    ]);
  }

  function removeLine(id: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((line) => line.id !== id) : prev,
    );
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.includes(id)) delete next[key];
      }
      return next;
    });
  }

  function validateLine(line: SaleLineDraft): Record<string, string> {
    const found: Record<string, string> = {};
    const productId = line.productId;
    if (productId === "") {
      found[`line-${line.id}-product`] = "Select a product.";
      return found;
    }
    const product = productById.get(productId);
    if (!product) {
      found[`line-${line.id}-product`] = "This product no longer exists.";
      return found;
    }
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      found[`line-${line.id}-qty`] =
        defaultUnit === "UNIT"
          ? "Enter a quantity of 1 or more."
          : "Enter a quantity greater than 0.";
    } else if (defaultUnit === "UNIT" && !Number.isInteger(qty)) {
      found[`line-${line.id}-qty`] = "Retail quantities must be whole units.";
    } else if (defaultUnit === "PACK") {
      const totalUnits = qty * product.unitsPerPack;
      if (!Number.isSafeInteger(totalUnits) || totalUnits <= 0) {
        found[`line-${line.id}-qty`] =
          `Quantity must add up to whole units (1 pack = ${product.unitsPerPack} units).`;
      }
    }

    if (
      !/^[0-9]+$/.test(line.unitPriceKobo) ||
      BigInt(line.unitPriceKobo || "0") <= 0n
    ) {
      found[`price-${line.id}`] = "Enter a price greater than zero.";
    }

    const units = lineUnits(line);
    const available = availableUnits(productId, location);
    if (units > available) {
      found[`line-${line.id}-qty`] =
        `Only ${available} units available at ${location.replace(/_/g, " ").toLowerCase()}.`;
    }

    return found;
  }

  function validateAll(): Record<string, string> {
    const found: Record<string, string> = {};

    if (soldAt === "") {
      found["sale-date"] = "Choose a date.";
    } else if (soldAt > businessDate) {
      found["sale-date"] = "The date cannot be in the future.";
    }

    if (customerId === "" && balanceOwed > 0n) {
      found["sale-customer"] =
        "Select a customer, or record full payment — a walk-in cannot owe money.";
    }

    if (paid > totalKobo) {
      found["paid"] = "Amount received cannot be more than the sale total.";
    }
    if (paid > 0n && defaultAccountId(accountsQuery.data ?? [], paymentMethod) === "") {
      found["sale-account"] = "Add an active account before recording received money.";
    }

    let hasValidLine = false;
    for (const line of lines) {
      const lineErrors = validateLine(line);
      Object.assign(found, lineErrors);
      if (Object.keys(lineErrors).length === 0) hasValidLine = true;
    }
    if (!hasValidLine && lines.length === 1) {
      found["lines"] = "Add at least one complete line item.";
    }

    return found;
  }

  function focusFirstError(found: Record<string, string>) {
    const order = [
      "sale-date",
      "sale-customer",
      "paid",
      "sale-account",
      "lines",
      ...lines.flatMap((line) => [
        `line-${line.id}-product`,
        `line-${line.id}-qty`,
        `price-${line.id}`,
      ]),
    ];
    const firstId = order.find((id) => found[id] !== undefined);
    if (!firstId) return;
    const element = document.getElementById(firstId);
    if (element instanceof HTMLElement) element.focus();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || createMutation.isPending) return;
    createMutation.reset();

    const found = validateAll();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      toast.warning("Please fix the highlighted fields.");
      return;
    }

    const validLines = lines.map((line) => ({
      productId: line.productId,
      unit: defaultUnit,
      quantity: Number(line.quantity),
      unitPriceKobo: line.unitPriceKobo,
    }));

    const input: CreateSaleDto = {
      customerId: customerId !== "" ? customerId : null,
      customerName: null,
      channel,
      location,
      soldAt: createLagosDateTime(soldAt).toISOString(),
      notes: notes.trim() === "" ? null : notes.trim(),
      reference: reference.trim() === "" ? null : reference.trim(),
      paidKobo: paid.toString(),
      accountId:
        paid > 0n
          ? accountId || defaultAccountId(accountsQuery.data ?? [], paymentMethod)
          : null,
      lines: validLines,
    };

    const customerLabel =
      channelCustomers.find((c) => c.id === customerId)?.name ?? "Walk-in";

    submitting.current = true;
    try {
      await confirm({
        title: "Record this sale?",
        description: "Confirm the details before saving.",
        confirmLabel: "Record sale",
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Channel">
              {channel === "RETAIL" ? "Retail (fridge)" : "Wholesale"}
            </SummaryRow>
            <SummaryRow label="Customer">{customerLabel}</SummaryRow>
            <SummaryRow label="Date">{soldAt}</SummaryRow>
            <SummaryRow label="Total">
              <Money kobo={totalKobo} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Paid">
              <Money kobo={paid.toString()} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Balance owed">
              <Money kobo={balanceOwed > 0n ? balanceOwed : 0n} />
            </SummaryRow>
          </dl>
        ),
        onConfirm: () => createMutation.mutateAsync(input),
      });
    } finally {
      submitting.current = false;
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="New sale"
        description="Record a retail (fridge) or wholesale sale."
        actions={
          <Link
            href="/sales"
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to sales
          </Link>
        }
      />

      {customersQueryFailed && (
        <ErrorState
          title="Some data could not be loaded"
          message="Some sale data failed to load. Check products, customers, stock and (when taking payment) accounts."
          onRetry={() => {
            void productsQuery.refetch();
            void customersQuery.refetch();
            void stockQuery.refetch();
            void accountsQuery.refetch();
          }}
        />
      )}

      <form onSubmit={submit} className="space-y-6" noValidate>
        {errorCount > 0 && (
          <div
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-surface p-4 text-sm text-danger"
          >
            <p className="font-medium">
              {errorCount === 1
                ? "There is 1 problem to fix"
                : `There are ${errorCount} problems to fix`}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(errors)
                .slice(0, 5)
                .map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
            </ul>
          </div>
        )}

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="sale-channel" label="Channel">
                <Select
                  id="sale-channel"
                  value={channel}
                  onChange={(event) => {
                    const next = event.target.value as SaleChannelForSale;
                    setChannel(next);
                    setCustomerId("");
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
                >
                  <option value="RETAIL">Retail (fridge) — per unit</option>
                  <option value="WHOLESALE">Wholesale — per pack</option>
                </Select>
              </FormField>

              <FormField id="sale-location" label="Stock location">
                <Input
                  id="sale-location"
                  value={location.replace(/_/g, " ")}
                  disabled
                />
              </FormField>

              <FormField
                id="sale-customer"
                label="Customer"
                hint="Pick the customer who is buying, or add a new one. A customer is required whenever part of the sale is left owing, so debts are never duplicated."
                error={errors["sale-customer"]}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      id="sale-customer"
                      value={customerId}
                      aria-invalid={errors["sale-customer"] !== undefined}
                      onChange={(event) => setCustomerId(event.target.value)}
                    >
                      <option value="">Walk-in (no customer)</option>
                      {channelCustomers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAddingCustomer(true)}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {channelCustomers.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No {channel === "RETAIL" ? "retail" : "wholesale"} customers
                    yet — use Add to create one.
                  </p>
                )}
              </FormField>

              <FormField
                id="sale-date"
                label="Date"
                error={errors["sale-date"]}
              >
                <Input
                  id="sale-date"
                  type="date"
                  value={soldAt}
                  max={businessDate}
                  aria-invalid={errors["sale-date"] !== undefined}
                  onChange={(event) => setSoldAt(event.target.value)}
                />
              </FormField>

              <FormField
                id="sale-reference"
                label="Reference"
                className="sm:col-span-2"
              >
                <Input
                  id="sale-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Receipt or invoice number"
                />
              </FormField>
            </div>

            <FormField id="sale-notes" label="Notes">
              <Textarea
                id="sale-notes"
                value={notes}
                rows={2}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={`Lines (${defaultUnit === "UNIT" ? "per unit" : "per pack"})`}
            action={
              <Button variant="secondary" size="sm" onClick={addLine}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add line
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {errors["lines"] && (
              <p role="alert" className="text-sm text-danger">
                {errors["lines"]}
              </p>
            )}
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const total = lineTotalKobo(line);
              const available = line.productId
                ? availableUnits(line.productId, location)
                : null;
              return (
                <div
                  key={line.id}
                  className="space-y-3 rounded-md border border-border bg-background/50 p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Line {index + 1}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:bg-danger/10"
                      disabled={lines.length === 1}
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FormField
                      id={`line-${line.id}-product`}
                      label="Product"
                      className="sm:col-span-2"
                      error={errors[`line-${line.id}-product`]}
                    >
                      <Select
                        id={`line-${line.id}-product`}
                        value={line.productId}
                        aria-invalid={
                          errors[`line-${line.id}-product`] !== undefined
                        }
                        onChange={(event) =>
                          onProductChange(line.id, event.target.value)
                        }
                      >
                        <option value="">Select product</option>
                        {productsQuery.data?.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField
                      id={`line-${line.id}-qty`}
                      label={`Quantity (${defaultUnit === "UNIT" ? "units" : "crates"})`}
                      error={errors[`line-${line.id}-qty`]}
                      hint={
                        available !== null &&
                        errors[`line-${line.id}-qty`] === undefined
                          ? `${available} units available`
                          : undefined
                      }
                    >
                      <Input
                        id={`line-${line.id}-qty`}
                        type="number"
                        inputMode="decimal"
                        min={defaultUnit === "UNIT" ? 1 : 0.01}
                        step={defaultUnit === "UNIT" ? 1 : "any"}
                        value={line.quantity}
                        aria-invalid={
                          errors[`line-${line.id}-qty`] !== undefined
                        }
                        onChange={(event) =>
                          updateLine(line.id, { quantity: event.target.value })
                        }
                        placeholder={
                          defaultUnit === "UNIT"
                            ? "e.g. 6"
                            : "e.g. 0.5, 0.75, 1"
                        }
                      />
                    </FormField>
                    <MoneyInput
                      id={`price-${line.id}`}
                      label={`Price per ${defaultUnit === "UNIT" ? "unit" : "pack"}`}
                      defaultValueKobo={line.unitPriceKobo}
                      onKoboChange={(value) =>
                        updateLine(line.id, { unitPriceKobo: value })
                      }
                    />
                    {errors[`price-${line.id}`] && (
                      <p
                        role="alert"
                        className="text-sm text-danger sm:col-span-3"
                      >
                        {errors[`price-${line.id}`]}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1 text-xs">
                    <span className="text-muted-foreground">
                      {product
                        ? `${product.packName} — ${product.unitsPerPack} units/pack${
                            Number.isInteger(lineUnits(line)) &&
                            lineUnits(line) > 0
                              ? ` · ${lineUnits(line)} units`
                              : ""
                          }`
                        : "—"}
                    </span>
                    <span className="font-medium text-foreground">
                      Line total: <Money kobo={total} tone="neutral" />
                    </span>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <MoneyInput
                  id="paid"
                  label="Amount received"
                  defaultValueKobo={paidKobo}
                  onKoboChange={(value) => setPaidKobo(value)}
                />
                {errors["paid"] && (
                  <p role="alert" className="mt-1 text-sm text-danger">
                    {errors["paid"]}
                  </p>
                )}
              </div>
              {paid > 0n && (
                <>
                  <FormField id="sale-payment-method" label="Payment method">
                    <Select
                      id="sale-payment-method"
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(event.target.value as PaymentMethod)
                      }
                    >
                      <option value="CASH">Cash</option>
                      <option value="TRANSFER">Transfer</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </FormField>
                  <AccountSelect
                    id="sale-account"
                    label="Received into"
                    accounts={accountsQuery.data ?? []}
                    accountId={accountId}
                    onChange={setAccountId}
                    method={paymentMethod}
                    disabled={accountsQuery.isPending || accountsQuery.isError}
                  />
                  {errors["sale-account"] && (
                    <p role="alert" className="text-sm text-danger sm:col-span-2">
                      {errors["sale-account"]}
                    </p>
                  )}
                  {accountsQuery.isError && (
                    <p role="alert" className="text-sm text-danger sm:col-span-2">
                      Accounts could not be loaded: {toUserMessage(accountsQuery.error)}
                    </p>
                  )}
                </>
              )}
              <div className="text-left sm:text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-semibold text-foreground">
                  <Money kobo={totalKobo} tone="neutral" />
                </p>
                {balanceOwed > 0n && (
                  <p className="text-xs text-danger">
                    Balance owed: <Money kobo={balanceOwed} />
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {createMutation.isError && (
                <p role="alert" className="text-sm text-danger">
                  {toUserMessage(createMutation.error)}
                </p>
              )}
              {network.offline && (
                <p className="text-sm text-warning">
                  You&rsquo;re offline. Changes can&rsquo;t be saved until you
                  reconnect.
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto"
                loading={createMutation.isPending}
                disabled={network.offline}
              >
                Record sale
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>

      <QuickAddCustomerDialog
        open={addingCustomer}
        defaultType={channel}
        onClose={() => setAddingCustomer(false)}
        onCreated={(customer) => setCustomerId(customer.id)}
      />
    </div>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}
