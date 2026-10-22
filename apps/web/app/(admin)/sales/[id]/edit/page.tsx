"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  computeSaleLineTotalKobo,
  createLagosDateTime,
  getLagosBusinessDate,
  parseQuantityText,
  quantityToWholeUnits,
  type CreateSaleDto,
  type PaymentMethod,
  type ProductDto,
  type StockLocation,
  type Unit,
} from "@fabtyna/shared";
import { QuickAddCustomerDialog } from "@/components/customers/quick-add-customer-dialog";
import {
  AccountSelect,
  defaultAccountId,
} from "@/components/accounting/account-select";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { useFormDraft } from "@/hooks/use-form-draft";
import { DraftBanner } from "@/components/draft-banner";
import { MoneyInput } from "@/components/money-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { accountingApi, customersApi, productsApi, salesApi, stockApi } from "@/lib/api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
import type { SaleDetailDto } from "@/lib/api/sales.api";

type SaleChannelForSale = "RETAIL" | "WHOLESALE";

type SaleLineDraft = {
  id: string;
  productId: string;
  quantity: string;
  unitPriceKobo: string;
};

function locationForChannel(channel: SaleChannelForSale): StockLocation {
  return channel === "RETAIL" ? "RETAIL_SHELF" : "WAREHOUSE";
}

// The API rejects client references that look system-generated.
const GENERATED_REFERENCE = /^[SP]-\d{8}-\d{6,}$/;

export default function EditSalePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const sale = useQuery({
    queryKey: queryKeys.sales.detail(id),
    queryFn: () => salesApi.getById(id),
  });

  if (sale.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Skeleton variant="text" count={2} className="max-w-xs" />
        <Skeleton variant="card" count={2} />
      </div>
    );
  }

  if (sale.isError) {
    const notFound =
      sale.error instanceof ApiError && sale.error.kind === "not-found";
    if (notFound) {
      return (
        <div className="mx-auto max-w-5xl">
          <EmptyState
            title="Sale not found"
            description="This sale may have been removed, or the link is incorrect."
            action={
              <Link
                href="/sales"
                className={buttonClasses({ variant: "secondary" })}
              >
                Back to sales
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState
          message={toUserMessage(sale.error)}
          onRetry={() => void sale.refetch()}
        />
      </div>
    );
  }

  if (!sale.data) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState title="Sale not found" description="No record to edit." />
      </div>
    );
  }

  if (sale.data.status === "VOIDED") {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          title="This sale was voided"
          description="A voided sale can no longer be edited."
          action={
            <Link
              href={`/sales/${sale.data.id}`}
              className={buttonClasses({ variant: "secondary" })}
            >
              View sale
            </Link>
          }
        />
      </div>
    );
  }

  return <SaleEditForm sale={sale.data} />;
}

function SaleEditForm({ sale }: { sale: SaleDetailDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();

  const [channel, setChannel] = useState<SaleChannelForSale>(sale.channel);
  const [customerId, setCustomerId] = useState<string>(sale.customer?.id ?? "");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [soldAt, setSoldAt] = useState<string>(() =>
    getLagosBusinessDate(new Date(sale.soldAt)),
  );
  const [reference, setReference] = useState<string>(
    GENERATED_REFERENCE.test(sale.reference ?? "") ? "" : (sale.reference ?? ""),
  );
  const [notes, setNotes] = useState<string>(sale.notes ?? "");
  const [paidKobo, setPaidKobo] = useState<string>(
    sale.livePaymentsKobo ?? sale.paidKobo,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");
  const [retailLocation, setRetailLocation] = useState<"RETAIL_SHELF" | "MARKET">(
    sale.lines[0]?.location === "MARKET" ? "MARKET" : "RETAIL_SHELF",
  );
  const flow = useWriteFlow();
  const retrySubmit = useRef<(() => Promise<void>) | null>(null);
  const originalReference = sale.reference ?? sale.id.slice(0, 8);
  const [lines, setLines] = useState<SaleLineDraft[]>(() =>
    sale.lines.length > 0
      ? sale.lines.map((line) => ({
          id: `${uid}-o-${line.id}`,
          productId: line.productId,
          quantity: String(line.quantity),
          unitPriceKobo: line.unitPriceKobo,
        }))
      : [
          {
            id: `${uid}-o-new`,
            productId: "",
            quantity: "",
            unitPriceKobo: "",
          },
        ],
  );
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
    queryFn: () => accountingApi.listPaymentAccounts(),
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

  /**
   * Units the original sale currently holds, per product. Saving voids the
   * original (releasing those units) and records a replacement, so these units
   * count as available again — but only at the original sale's location.
   */
  const originalUnitsByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of sale.lines) {
      map.set(
        line.productId,
        (map.get(line.productId) ?? 0) + line.quantityUnits,
      );
    }
    return map;
  }, [sale.lines]);

  const originalLocation: StockLocation =
    (sale.lines[0]?.location as StockLocation | undefined) ??
    locationForChannel(sale.channel);

  const location: StockLocation =
    channel === "RETAIL" ? retailLocation : "WAREHOUSE";
  const defaultUnit: Unit = channel === "RETAIL" ? "UNIT" : "PACK";

  const offeredProducts = useMemo(
    () =>
      (productsQuery.data ?? []).filter(
        (p) => p.saleChannel === "BOTH" || p.saleChannel === channel,
      ),
    [productsQuery.data, channel],
  );

  const channelCustomers = useMemo(() => {
    return (customersQuery.data ?? []).filter((c) => c.type === channel);
  }, [customersQuery.data, channel]);

  function availableUnits(productId: string, loc: StockLocation): number {
    const current = stockByProduct.get(productId)?.get(loc) ?? 0;
    const returned =
      loc === originalLocation
        ? (originalUnitsByProduct.get(productId) ?? 0)
        : 0;
    return current + returned;
  }

  function lineUnits(line: SaleLineDraft): number {
    const parsed = parseQuantityText(line.quantity);
    if (!parsed.ok) return 0;
    const product = productById.get(line.productId);
    const units = quantityToWholeUnits(
      parsed.scaledQuantity,
      defaultUnit,
      product?.unitsPerPack ?? 1,
    );
    return units === null ? 0 : Number(units);
  }

  /** Exact total from the shared domain helper, identical to what `recordSale` stores. */
  function lineTotalKobo(line: SaleLineDraft): bigint {
    const parsed = parseQuantityText(line.quantity);
    if (!parsed.ok || !/^[0-9]+$/.test(line.unitPriceKobo)) return 0n;
    return computeSaleLineTotalKobo(parsed.scaledQuantity, BigInt(line.unitPriceKobo));
  }

  const totalKobo = lines.reduce((sum, line) => sum + lineTotalKobo(line), 0n);
  const paid = /^[0-9]+$/.test(paidKobo) ? BigInt(paidKobo) : 0n;
  const balanceOwed = totalKobo - paid;

  const supportQueryFailed =
    productsQuery.isError || customersQuery.isError || stockQuery.isError;

  // A new intent whenever the form changes: new idempotency key.
  const formSnapshot = JSON.stringify([
    channel,
    customerId,
    soldAt,
    reference,
    notes,
    paidKobo,
    paymentMethod,
    accountId,
    retailLocation,
    lines,
  ]);
  const { edit: renewKey } = flow;
  useEffect(() => {
    renewKey();
  }, [formSnapshot, renewKey]);

  // Dirty = differs from what the server gave us, so an untouched edit form saves nothing.
  const [pristineSnapshot] = useState(formSnapshot);
  const draft = useFormDraft({
    form: `sale-edit:${sale.id}`,
    dirty: formSnapshot !== pristineSnapshot,
    state: {
      channel,
      customerId,
      soldAt,
      reference,
      notes,
      paidKobo,
      paymentMethod,
      accountId,
      retailLocation,
      lines,
    },
    onRestore: (saved) => {
      setChannel(saved.channel);
      setCustomerId(saved.customerId);
      setSoldAt(saved.soldAt);
      setReference(saved.reference);
      setNotes(saved.notes);
      setPaidKobo(saved.paidKobo);
      setPaymentMethod(saved.paymentMethod);
      setAccountId(saved.accountId);
      setRetailLocation(saved.retailLocation);
      // Fresh ids: useId repeats after a reload and could collide with new lines.
      setLines(
        saved.lines.length > 0
          ? saved.lines.map((line, index) => ({ ...line, id: `${uid}-r${index}` }))
          : [{ id: `${uid}-r0`, productId: "", quantity: "", unitPriceKobo: "" }],
      );
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
    const id = `${uid}-n-${lineSeq.current}`;
    lineSeq.current += 1;
    return id;
  }

  function addLine() {
    setLines((prev) => [
      { id: newLineId(), productId: "", quantity: "", unitPriceKobo: "" },
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
    const parsedQty = parseQuantityText(line.quantity);
    if (product.saleChannel !== "BOTH" && product.saleChannel !== channel) {
      found[`line-${line.id}-product`] =
        `${product.name} is not sold on the ${channel.toLowerCase()} channel.`;
      return found;
    }
    if (!parsedQty.ok) {
      found[`line-${line.id}-qty`] = parsedQty.message;
    } else if (
      quantityToWholeUnits(parsedQty.scaledQuantity, defaultUnit, product.unitsPerPack) ===
      null
    ) {
      found[`line-${line.id}-qty`] =
        defaultUnit === "UNIT"
          ? "Retail quantities must be whole units."
          : `Quantity must add up to whole units (1 pack = ${product.unitsPerPack} units).`;
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
    if (
      paid > 0n &&
      (accountId || defaultAccountId(accountsQuery.data ?? [], paymentMethod)) === ""
    ) {
      found["sale-account"] = "Choose an active account for the money received.";
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
      "lines",
      ...lines.flatMap((line) => [
        `line-${line.id}-product`,
        `line-${line.id}-qty`,
        `price-${line.id}`,
      ]),
    ];
    const firstId = order.find((key) => found[key] !== undefined);
    if (!firstId) return;
    const element = document.getElementById(firstId);
    if (element instanceof HTMLElement) element.focus();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || flow.pending) return;
    const found = validateAll();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      toast.warning("Please fix the highlighted fields.");
      return;
    }

    const input: CreateSaleDto = {
      customerId: customerId !== "" ? customerId : null,
      customerName: null,
      channel,
      location,
      soldAt: createLagosDateTime(soldAt).toISOString(),
      notes: notes.trim() === "" ? null : notes.trim(),
      reference:
        GENERATED_REFERENCE.test(reference.trim()) || reference.trim() === ""
          ? null
          : reference.trim(),
      paidKobo: paid.toString(),
      accountId:
        paid > 0n
          ? accountId ||
            defaultAccountId(accountsQuery.data ?? [], paymentMethod)
          : null,
      lines: lines.map((line) => ({
        productId: line.productId,
        unit: defaultUnit,
        quantity: (() => {
          const parsed = parseQuantityText(line.quantity);
          if (!parsed.ok) throw new Error(parsed.message);
          return parsed.jsonNumber;
        })(),
        unitPriceKobo: line.unitPriceKobo,
      })),
    };

    const customerLabel =
      channelCustomers.find((c) => c.id === customerId)?.name ?? "Walk-in";

    submitting.current = true;
    try {
      const ok = await confirm({
        title: "Save these changes?",
        description: `${originalReference} will be voided and a new sale recorded with a new reference.`,
        confirmLabel: "Save changes",
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Channel">
              {channel === "RETAIL" ? "Retail (fridge)" : "Wholesale"}
            </SummaryRow>
            <SummaryRow label="Stock from">
              {location.replace(/_/g, " ")}
            </SummaryRow>
            <SummaryRow label="Customer">{customerLabel}</SummaryRow>
            <SummaryRow label="Date">{soldAt}</SummaryRow>
            <SummaryRow label="New total">
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
      });
      if (!ok) return;
      const previewTotal = totalKobo;
      const run = async () => {
        const updated = await flow.run((key) =>
          salesApi.update(sale.id, input, key),
        );
        if (!updated) return;
        if (
          process.env.NODE_ENV !== "production" &&
          updated.totalKobo !== previewTotal.toString()
        ) {
          console.warn(
            `Sale preview total ${previewTotal} differs from server total ${updated.totalKobo}.`,
          );
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.debtors.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
        toast.success(
          `${originalReference} was voided and replaced by ${updated.reference ?? "a new sale"}.`,
        );
        const voidedId = updated.voidedSaleId;
        draft.clear();
        router.push(
          voidedId
            ? `/sales/${updated.id}?replaced=${encodeURIComponent(voidedId)}`
            : `/sales/${updated.id}`,
        );
      };
      retrySubmit.current = run;
      await run();
    } finally {
      submitting.current = false;
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Edit sale"
        description={`Correct a mistake on ${sale.reference ?? sale.id.slice(0, 8)}.`}
        actions={
          <Link
            href={`/sales/${sale.id}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to sale
          </Link>
        }
      />

      <div className="rounded-md border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
        Saving will <strong>void {originalReference}</strong> and create a{" "}
        <strong>new sale with a new reference</strong>. Stock, the customer
        balance and any money taken up front are reversed and re-recorded, so
        everything stays auditable. The live payments so far are consolidated
        into &ldquo;Amount received&rdquo;, and the account must be chosen
        again.
      </div>

      {supportQueryFailed && (
        <ErrorState
          title="Some data could not be loaded"
          message="Products, customers or stock failed to load, so quantities cannot be validated."
          onRetry={() => {
            void productsQuery.refetch();
            void customersQuery.refetch();
            void stockQuery.refetch();
          }}
        />
      )}

      <DraftBanner draft={draft} />

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
                {channel === "RETAIL" ? (
                  <Select
                    id="sale-location"
                    value={retailLocation}
                    onChange={(event) =>
                      setRetailLocation(
                        event.target.value as "RETAIL_SHELF" | "MARKET",
                      )
                    }
                  >
                    <option value="RETAIL_SHELF">Retail shelf (fridge)</option>
                    <option value="MARKET">Market</option>
                  </Select>
                ) : (
                  <Input
                    id="sale-location"
                    value={location.replace(/_/g, " ")}
                    disabled
                  />
                )}
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
                        {offeredProducts.map((option) => (
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
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
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
                      onChange={(event) => {
                        setPaymentMethod(event.target.value as PaymentMethod);
                        setAccountId("");
                      }}
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
              {flow.status !== "idle" && (
                <WriteFlowStatus
                  flow={flow}
                  onRetry={() => void retrySubmit.current?.()}
                  checkHref={`/sales?q=${encodeURIComponent(originalReference)}`}
                  checkLabel="Check recent sales"
                />
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
                loading={flow.pending}
                disabled={network.offline || flow.status === "unknown"}
              >
                Save changes
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
