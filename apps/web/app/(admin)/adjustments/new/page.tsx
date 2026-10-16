"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  formatStockUnits,
  getLagosBusinessDate,
  type CreateAdjustmentDto,
  type ProductDto,
  type StockLocation,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { adjustmentsApi, productsApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

type AdjustmentDirection = "INCREASE" | "DECREASE";

type AdjustmentLineDraft = {
  id: string;
  productId: string;
  location: StockLocation;
  direction: AdjustmentDirection;
  quantity: string;
  unitCostKobo: string;
};

const LOCATIONS: StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

function lineDelta(line: AdjustmentLineDraft): number {
  const qty = Number(line.quantity);
  if (!Number.isInteger(qty) || qty <= 0) return 0;
  return line.direction === "INCREASE" ? qty : -qty;
}

export default function NewAdjustmentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();

  const [reason, setReason] = useState<string>("");
  const [adjustedAt, setAdjustedAt] = useState<string>(() =>
    getLagosBusinessDate(),
  );
  const [lines, setLines] = useState<AdjustmentLineDraft[]>([
    {
      id: `${uid}-0`,
      productId: "",
      location: "WAREHOUSE",
      direction: "INCREASE",
      quantity: "",
      unitCostKobo: "",
    },
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

  const productById = useMemo(() => {
    const map = new Map<string, ProductDto>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product);
    }
    return map;
  }, [productsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (input: CreateAdjustmentDto) => adjustmentsApi.create(input),
    onSuccess: (adjustment) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adjustments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      toast.success(`Adjustment ${adjustment.id.slice(0, 8)} recorded.`);
      router.push(`/adjustments/${adjustment.id}`);
    },
    onError: (error) => {
      toast.error(toUserMessage(error));
    },
  });

  function updateLine(id: string, patch: Partial<AdjustmentLineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
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
        location: "WAREHOUSE",
        direction: "INCREASE",
        quantity: "",
        unitCostKobo: "",
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

  function setFieldErrors(keys: string[], found: Record<string, string>) {
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      Object.assign(next, found);
      return next;
    });
  }

  function validateReason(): Record<string, string> {
    return reason.trim() === ""
      ? { "adjustment-reason": "Enter a reason for this adjustment." }
      : {};
  }

  function validateDate(): Record<string, string> {
    if (adjustedAt === "") {
      return { "adjustment-date": "Choose a date." };
    }
    if (adjustedAt > businessDate) {
      return { "adjustment-date": "The date cannot be in the future." };
    }
    return {};
  }

  function validateLineProduct(
    line: AdjustmentLineDraft,
  ): Record<string, string> {
    if (line.productId === "") {
      return { [`line-${line.id}-product`]: "Select a product." };
    }
    if (!productById.has(line.productId)) {
      return { [`line-${line.id}-product`]: "This product no longer exists." };
    }
    return {};
  }

  function validateLineQuantity(
    line: AdjustmentLineDraft,
  ): Record<string, string> {
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return {
        [`line-${line.id}-qty`]: "Enter a whole number of 1 or more.",
      };
    }
    return {};
  }

  function validateLine(line: AdjustmentLineDraft): Record<string, string> {
    return { ...validateLineProduct(line), ...validateLineQuantity(line) };
  }

  function validateAll(): Record<string, string> {
    const found: Record<string, string> = {
      ...validateReason(),
      ...validateDate(),
    };
    for (const line of lines) {
      Object.assign(found, validateLine(line));
    }
    return found;
  }

  function focusFirstError(found: Record<string, string>) {
    const order = [
      "adjustment-reason",
      "adjustment-date",
      ...lines.flatMap((line) => [
        `line-${line.id}-product`,
        `line-${line.id}-qty`,
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

    const input: CreateAdjustmentDto = {
      reason: reason.trim(),
      adjustedAt: createLagosDateTime(adjustedAt).toISOString(),
      lines: lines.map((line) => {
        const delta = lineDelta(line);
        const out: CreateAdjustmentDto["lines"][number] = {
          productId: line.productId,
          location: line.location,
          quantityDeltaUnits: delta,
        };
        if (delta > 0 && /^[0-9]+$/.test(line.unitCostKobo)) {
          out.unitCostKobo = line.unitCostKobo;
        }
        return out;
      }),
    };

    submitting.current = true;
    try {
      await confirm({
        title: "Record this adjustment?",
        description: "Confirm the details before saving.",
        confirmLabel: "Record adjustment",
        details: (
          <ul className="space-y-2 text-sm">
            {lines.map((line) => {
              const product = productById.get(line.productId);
              const delta = lineDelta(line);
              const increases = delta > 0;
              return (
                <li key={line.id} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="min-w-0 truncate font-medium">
                      {product?.name ?? line.productId}
                    </span>
                    <span className="shrink-0 tabular">
                      {increases ? "+" : "−"}
                      {Math.abs(delta)} units
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {increases ? "Increase" : "Decrease"}{" "}
                    {line.location.replace(/_/g, " ")} stock
                    {product
                      ? ` by ${formatStockUnits(
                          Math.abs(delta),
                          product.unitsPerPack,
                          product.packName,
                        )}`
                      : ""}
                    .
                  </p>
                </li>
              );
            })}
          </ul>
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
        title="New adjustment"
        description="Correct stock counts. Increase for found stock, decrease for lost or damaged."
        actions={
          <Link
            href="/adjustments"
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to adjustments
          </Link>
        }
      />

      {productsQuery.isError && (
        <ErrorState
          title="Some data could not be loaded"
          message="Products failed to load, so line items cannot be validated."
          onRetry={() => void productsQuery.refetch()}
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
              <FormField
                id="adjustment-reason"
                label="Reason"
                required
                error={errors["adjustment-reason"]}
              >
                <Input
                  id="adjustment-reason"
                  value={reason}
                  aria-invalid={errors["adjustment-reason"] !== undefined}
                  onBlur={() =>
                    setFieldErrors(["adjustment-reason"], validateReason())
                  }
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Damaged stock, found extra"
                />
              </FormField>

              <FormField
                id="adjustment-date"
                label="Date"
                error={errors["adjustment-date"]}
              >
                <Input
                  id="adjustment-date"
                  type="date"
                  value={adjustedAt}
                  max={businessDate}
                  aria-invalid={errors["adjustment-date"] !== undefined}
                  onBlur={() =>
                    setFieldErrors(["adjustment-date"], validateDate())
                  }
                  onChange={(event) => setAdjustedAt(event.target.value)}
                />
              </FormField>
            </div>
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
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const increases = line.direction === "INCREASE";
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
                      className="sm:col-span-2"
                      error={errors[`line-${line.id}-product`]}
                    >
                      <Select
                        id={`line-${line.id}-product`}
                        value={line.productId}
                        aria-invalid={
                          errors[`line-${line.id}-product`] !== undefined
                        }
                        onBlur={() =>
                          setFieldErrors(
                            [`line-${line.id}-product`],
                            validateLineProduct(line),
                          )
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

                    <FormField id={`line-${line.id}-location`} label="Location">
                      <Select
                        id={`line-${line.id}-location`}
                        value={line.location}
                        onChange={(event) =>
                          updateLine(line.id, {
                            location: event.target.value as StockLocation,
                          })
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
                      id={`line-${line.id}-direction`}
                      label="Effect"
                    >
                      <Select
                        id={`line-${line.id}-direction`}
                        value={line.direction}
                        onChange={(event) =>
                          updateLine(line.id, {
                            direction: event.target.value as AdjustmentDirection,
                          })
                        }
                      >
                        <option value="INCREASE">Increase (found stock)</option>
                        <option value="DECREASE">
                          Decrease (lost or damaged)
                        </option>
                      </Select>
                    </FormField>

                    <FormField
                      id={`line-${line.id}-qty`}
                      label="Quantity (units)"
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
                        onBlur={() =>
                          setFieldErrors(
                            [`line-${line.id}-qty`],
                            validateLineQuantity(line),
                          )
                        }
                        onChange={(event) =>
                          updateLine(line.id, { quantity: event.target.value })
                        }
                        placeholder="e.g. 6"
                      />
                    </FormField>

                    {increases && (
                      <MoneyInput
                        id={`cost-${line.id}`}
                        label="Unit cost (optional)"
                        defaultValueKobo={line.unitCostKobo}
                        onKoboChange={(value) =>
                          updateLine(line.id, { unitCostKobo: value })
                        }
                      />
                    )}
                  </div>
                  {product && (
                    <p className="text-xs text-muted-foreground">
                      {product.packName} — {product.unitsPerPack} units/pack
                    </p>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
              Save adjustment
            </Button>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
