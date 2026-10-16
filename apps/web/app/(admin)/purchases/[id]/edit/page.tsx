"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { productsApi, purchasesApi, suppliersApi } from "@/lib/api";
import type { PurchaseDetailDto } from "@/lib/api/purchases.api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

type PurchaseLineDraft = {
  id: string;
  productId: string;
  unit: Unit;
  quantity: string;
  pricePerUnitKobo: string;
};

const LOCATIONS: StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export default function EditPurchasePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const purchase = useQuery({
    queryKey: queryKeys.purchases.detail(id),
    queryFn: () => purchasesApi.getById(id),
  });

  if (purchase.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Skeleton variant="text" count={2} className="max-w-xs" />
        <Skeleton variant="card" count={2} />
      </div>
    );
  }

  if (purchase.isError) {
    const notFound =
      purchase.error instanceof ApiError && purchase.error.kind === "not-found";
    if (notFound) {
      return (
        <div className="mx-auto max-w-5xl">
          <EmptyState
            title="Purchase not found"
            description="This purchase may have been removed, or the link is incorrect."
            action={
              <Link
                href="/purchases"
                className={buttonClasses({ variant: "secondary" })}
              >
                Back to purchases
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState
          title="Purchase could not be loaded"
          message={toUserMessage(purchase.error)}
          onRetry={() => void purchase.refetch()}
        />
      </div>
    );
  }

  if (!purchase.data) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState title="Purchase not found" description="No record to edit." />
      </div>
    );
  }

  if (purchase.data.status === "VOIDED") {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          title="This purchase was voided"
          description="A voided purchase can no longer be edited."
          action={
            <Link
              href={`/purchases/${purchase.data.id}`}
              className={buttonClasses({ variant: "secondary" })}
            >
              View purchase
            </Link>
          }
        />
      </div>
    );
  }

  return <PurchaseEditForm purchase={purchase.data} />;
}

function PurchaseEditForm({ purchase }: { purchase: PurchaseDetailDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();

  const [supplierId, setSupplierId] = useState<string>(
    purchase.supplier?.id ?? "",
  );
  const [location, setLocation] = useState<StockLocation>(
    purchase.movements[0]?.location ?? "WAREHOUSE",
  );
  const [purchasedAt, setPurchasedAt] = useState<string>(() =>
    getLagosBusinessDate(new Date(purchase.purchasedAt)),
  );
  const [reference, setReference] = useState<string>(purchase.reference ?? "");
  const [notes, setNotes] = useState<string>(purchase.notes ?? "");
  const [lines, setLines] = useState<PurchaseLineDraft[]>(() =>
    purchase.lines.length > 0
      ? purchase.lines.map((line) => ({
          id: `${uid}-o-${line.id}`,
          productId: line.productId,
          unit: line.unit,
          quantity: String(line.quantity),
          pricePerUnitKobo: (
            BigInt(line.lineTotalKobo) / BigInt(line.quantity)
          ).toString(),
        }))
      : [
          {
            id: `${uid}-o-new`,
            productId: "",
            unit: "PACK" as Unit,
            quantity: "",
            pricePerUnitKobo: "",
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

  /**
   * Mirrors `receivePurchase` in the domain so the preview matches the saved
   * line total: lineTotalKobo = quantity × price per unit (pack or unit).
   */
  function lineTotalKobo(line: PurchaseLineDraft): bigint {
    const qty = Number(line.quantity);
    const price = line.pricePerUnitKobo;
    if (!Number.isSafeInteger(qty) || qty <= 0 || !/^[0-9]+$/.test(price)) {
      return 0n;
    }
    return BigInt(qty) * BigInt(price);
  }

  const totalKobo = lines.reduce((sum, line) => sum + lineTotalKobo(line), 0n);

  const supportQueryFailed = productsQuery.isError || suppliersQuery.isError;

  const updateMutation = useMutation({
    mutationFn: (input: CreatePurchaseDto) =>
      purchasesApi.update(purchase.id, input),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      toast.success(
        `Purchase updated — ${formatNaira(totalKobo)} recorded; the original was voided.`,
      );
      router.push(`/purchases/${updated.id}`);
    },
  });

  function updateLine(id: string, patch: Partial<PurchaseLineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function newLineId(): string {
    const id = `${uid}-n-${lineSeq.current}`;
    lineSeq.current += 1;
    return id;
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

  function validateLine(line: PurchaseLineDraft): Record<string, string> {
    const found: Record<string, string> = {};
    if (line.productId === "") {
      found[`line-${line.id}-product`] = "Select a product.";
      return found;
    }
    const product = productById.get(line.productId);
    if (!product) {
      found[`line-${line.id}-product`] = "This product no longer exists.";
      return found;
    }

    const qty = Number(line.quantity);
    if (line.quantity.trim() === "" || !Number.isSafeInteger(qty) || qty <= 0) {
      found[`line-${line.id}-qty`] =
        line.unit === "PACK"
          ? "Enter a whole number of packs (1 or more)."
          : "Enter a whole number of units (1 or more).";
    }

    if (!/^[0-9]+$/.test(line.pricePerUnitKobo)) {
      found[`price-${line.id}`] = "Enter a price for this line.";
    } else if (lineTotalKobo(line) < 0n) {
      found[`price-${line.id}`] = "The line total cannot be negative.";
    }

    return found;
  }

  function validateAll(): Record<string, string> {
    const found: Record<string, string> = {};

    if (purchasedAt === "") {
      found["purchase-date"] = "Choose a date.";
    } else if (purchasedAt > businessDate) {
      found["purchase-date"] = "The date cannot be in the future.";
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
      "purchase-date",
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
    if (submitting.current || updateMutation.isPending) return;
    updateMutation.reset();

    const found = validateAll();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      toast.warning("Please fix the highlighted fields.");
      return;
    }

    const input: CreatePurchaseDto = {
      supplierId: supplierId === "" ? null : supplierId,
      location,
      purchasedAt: createLagosDateTime(purchasedAt).toISOString(),
      notes: notes.trim() === "" ? null : notes.trim(),
      reference: reference.trim() === "" ? null : reference.trim(),
      lines: lines.map((line) => ({
        productId: line.productId,
        unit: line.unit,
        quantity: Number(line.quantity),
        lineTotalKobo: lineTotalKobo(line).toString(),
      })),
    };

    const supplierLabel =
      suppliersQuery.data?.find((supplier) => supplier.id === supplierId)
        ?.name ?? "No supplier";

    submitting.current = true;
    try {
      await confirm({
        title: "Save these changes?",
        description:
          "The original purchase will be voided and a corrected copy recorded, so stock and the supplier ledger stay accurate and fully auditable.",
        confirmLabel: "Save changes",
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Supplier">{supplierLabel}</SummaryRow>
            <SummaryRow label="Reference">
              {reference.trim() === "" ? "—" : reference.trim()}
            </SummaryRow>
            <SummaryRow label="Date">{purchasedAt}</SummaryRow>
            <SummaryRow label="New total">
              <Money kobo={totalKobo} tone="neutral" />
            </SummaryRow>
            <div className="border-t border-border pt-1.5">
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="mt-1 space-y-0.5">
                {lines.map((line) => (
                  <div key={line.id} className="flex justify-between gap-4">
                    <span className="min-w-0 truncate">
                      {productById.get(line.productId)?.name ?? "Product"} ·{" "}
                      {line.quantity}
                      {line.unit === "PACK" ? " pack(s)" : " unit(s)"}
                    </span>
                    <Money kobo={lineTotalKobo(line)} tone="neutral" />
                  </div>
                ))}
              </dd>
            </div>
          </dl>
        ),
        onConfirm: () => updateMutation.mutateAsync(input),
      });
    } finally {
      submitting.current = false;
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Edit purchase"
        description={`Correct a mistake on ${purchase.reference ?? purchase.id.slice(0, 8)}.`}
        actions={
          <Link
            href={`/purchases/${purchase.id}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to purchase
          </Link>
        }
      />

      <div className="rounded-md border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
        Saving will <strong>void the original purchase</strong> and record a
        corrected copy so the stock and supplier ledger stay accurate and fully
        auditable.
      </div>

      {supportQueryFailed && (
        <ErrorState
          title="Some data could not be loaded"
          message="Products or suppliers failed to load, so this purchase cannot be validated."
          onRetry={() => {
            void productsQuery.refetch();
            void suppliersQuery.refetch();
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
              <FormField id="purchase-supplier" label="Supplier (optional)">
                <Select
                  id="purchase-supplier"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">No supplier</option>
                  {suppliersQuery.data?.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField id="purchase-location" label="Receiving location">
                <Select
                  id="purchase-location"
                  value={location}
                  onChange={(event) =>
                    setLocation(event.target.value as StockLocation)
                  }
                >
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                id="purchase-date"
                label="Date"
                error={errors["purchase-date"]}
              >
                <Input
                  id="purchase-date"
                  type="date"
                  value={purchasedAt}
                  max={businessDate}
                  aria-invalid={errors["purchase-date"] !== undefined}
                  onChange={(event) => setPurchasedAt(event.target.value)}
                />
              </FormField>

              <FormField id="purchase-reference" label="Reference">
                <Input
                  id="purchase-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Invoice or GRN number"
                />
              </FormField>
            </div>

            <FormField id="purchase-notes" label="Notes">
              <Textarea
                id="purchase-notes"
                value={notes}
                rows={2}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lines"
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                      id={`line-${line.id}-product`}
                      label="Product"
                      error={errors[`line-${line.id}-product`]}
                    >
                      <Select
                        id={`line-${line.id}-product`}
                        value={line.productId}
                        aria-invalid={
                          errors[`line-${line.id}-product`] !== undefined
                        }
                        onChange={(event) =>
                          updateLine(line.id, { productId: event.target.value })
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
                    <FormField id={`line-${line.id}-unit`} label="Unit">
                      <Select
                        id={`line-${line.id}-unit`}
                        value={line.unit}
                        onChange={(event) =>
                          updateLine(line.id, {
                            unit: event.target.value as Unit,
                          })
                        }
                      >
                        <option value="PACK">Pack ({unitsPerPack} units)</option>
                        <option value="UNIT">Single unit</option>
                      </Select>
                    </FormField>
                    <FormField
                      id={`line-${line.id}-qty`}
                      label="Quantity"
                      error={errors[`line-${line.id}-qty`]}
                    >
                      <Input
                        id={`line-${line.id}-qty`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={line.quantity}
                        aria-invalid={
                          errors[`line-${line.id}-qty`] !== undefined
                        }
                        onChange={(event) =>
                          updateLine(line.id, { quantity: event.target.value })
                        }
                        placeholder="e.g. 2"
                      />
                    </FormField>
                    <MoneyInput
                      id={`price-${line.id}`}
                      label={`Price per ${line.unit === "PACK" ? "pack" : "unit"}`}
                      defaultValueKobo={line.pricePerUnitKobo}
                      onKoboChange={(value) =>
                        updateLine(line.id, { pricePerUnitKobo: value })
                      }
                    />
                    {errors[`price-${line.id}`] && (
                      <p
                        role="alert"
                        className="text-sm text-danger sm:col-span-2"
                      >
                        {errors[`price-${line.id}`]}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-1 text-xs">
                    <span className="text-muted-foreground">
                      {Number.isFinite(quantityUnits) && quantityUnits > 0
                        ? `${quantityUnits} units`
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
            <div className="text-left sm:text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold text-foreground">
                <Money kobo={totalKobo} tone="neutral" />
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {updateMutation.isError && (
                <p role="alert" className="text-sm text-danger">
                  {toUserMessage(updateMutation.error)}
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
                loading={updateMutation.isPending}
                disabled={network.offline}
              >
                Save changes
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
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
