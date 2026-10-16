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
  type CreateTransferDto,
  type ProductDto,
  type StockLocation,
} from "@fabtyna/shared";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { productsApi, stockApi, transfersApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

type TransferLineDraft = {
  id: string;
  productId: string;
  quantityUnits: string;
};

const LOCATIONS: StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export default function NewTransferPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();

  const [from, setFrom] = useState<StockLocation>("WAREHOUSE");
  const [to, setTo] = useState<StockLocation>("RETAIL_SHELF");
  const [reason, setReason] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [transferredAt, setTransferredAt] = useState<string>(() =>
    getLagosBusinessDate(),
  );
  const [lines, setLines] = useState<TransferLineDraft[]>([
    { id: `${uid}-0`, productId: "", quantityUnits: "" },
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
  const stockQuery = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
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

  function availableUnits(productId: string, location: StockLocation): number {
    return stockByProduct.get(productId)?.get(location) ?? 0;
  }

  const createMutation = useMutation({
    mutationFn: (input: CreateTransferDto) => transfersApi.create(input),
    onSuccess: (transfer) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      toast.success(
        `Transfer ${transfer.reference ?? transfer.id.slice(0, 8)} recorded.`,
      );
      router.push(`/transfers/${transfer.id}`);
    },
    onError: (error) => {
      toast.error(toUserMessage(error));
    },
  });

  function updateLine(id: string, patch: Partial<TransferLineDraft>) {
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
      { id: newLineId(), productId: "", quantityUnits: "" },
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

  function validateDate(): Record<string, string> {
    if (transferredAt === "") {
      return { "transfer-date": "Choose a date." };
    }
    if (transferredAt > businessDate) {
      return { "transfer-date": "The date cannot be in the future." };
    }
    return {};
  }

  function validateLocations(): Record<string, string> {
    return from === to
      ? { "transfer-to": "From and to locations must be different." }
      : {};
  }

  function validateLineProduct(line: TransferLineDraft): Record<string, string> {
    if (line.productId === "") {
      return { [`line-${line.id}-product`]: "Select a product." };
    }
    if (!productById.has(line.productId)) {
      return { [`line-${line.id}-product`]: "This product no longer exists." };
    }
    return {};
  }

  function validateLineQuantity(
    line: TransferLineDraft,
  ): Record<string, string> {
    const product = productById.get(line.productId);
    if (!product) return {};
    const qty = Number(line.quantityUnits);
    if (!Number.isInteger(qty) || qty <= 0) {
      return {
        [`line-${line.id}-qty`]: "Enter a whole number of 1 or more.",
      };
    }
    const available = availableUnits(line.productId, from);
    if (qty > available) {
      return {
        [`line-${line.id}-qty`]: `Only ${formatStockUnits(
          available,
          product.unitsPerPack,
          product.packName,
        )} available at ${from.replace(/_/g, " ").toLowerCase()}.`,
      };
    }
    return {};
  }

  function validateLine(line: TransferLineDraft): Record<string, string> {
    return { ...validateLineProduct(line), ...validateLineQuantity(line) };
  }

  function validateAll(): Record<string, string> {
    const found: Record<string, string> = {
      ...validateDate(),
      ...validateLocations(),
    };
    for (const line of lines) {
      Object.assign(found, validateLine(line));
    }
    return found;
  }

  function focusFirstError(found: Record<string, string>) {
    const order = [
      "transfer-from",
      "transfer-to",
      "transfer-date",
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

    const preparedLines = lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      quantityUnits: Number(line.quantityUnits),
    }));

    const input: CreateTransferDto = {
      from,
      to,
      reason: reason.trim() === "" ? null : reason.trim(),
      reference: reference.trim() === "" ? null : reference.trim(),
      transferredAt: createLagosDateTime(transferredAt).toISOString(),
      lines: preparedLines.map(({ productId, quantityUnits }) => ({
        productId,
        quantityUnits,
      })),
    };

    submitting.current = true;
    try {
      await confirm({
        title: "Record this transfer?",
        description: "Confirm the details before saving.",
        confirmLabel: "Record transfer",
        details: (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Stock moves from{" "}
              <span className="font-medium text-foreground">
                {from.replace(/_/g, " ")}
              </span>{" "}
              to{" "}
              <span className="font-medium text-foreground">
                {to.replace(/_/g, " ")}
              </span>
              .
            </p>
            <ul className="space-y-1.5">
              {preparedLines.map((line) => {
                const product = productById.get(line.productId);
                return (
                  <li
                    key={line.id}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="min-w-0 truncate">
                      {product?.name ?? line.productId}
                    </span>
                    <span className="shrink-0 tabular font-medium">
                      {product
                        ? formatStockUnits(
                            line.quantityUnits,
                            product.unitsPerPack,
                            product.packName,
                          )
                        : `${line.quantityUnits} units`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ),
        onConfirm: () => createMutation.mutateAsync(input),
      });
    } finally {
      submitting.current = false;
    }
  }

  const errorCount = Object.keys(errors).length;
  const productsFailed = productsQuery.isError || stockQuery.isError;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="New transfer"
        description="Move stock between locations."
        actions={
          <Link
            href="/transfers"
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to transfers
          </Link>
        }
      />

      {productsFailed && (
        <ErrorState
          title="Some data could not be loaded"
          message="Products or stock failed to load, so quantities cannot be validated."
          onRetry={() => {
            void productsQuery.refetch();
            void stockQuery.refetch();
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
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="transfer-from" label="From">
                <Select
                  id="transfer-from"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value as StockLocation);
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next["transfer-to"];
                      return next;
                    });
                  }}
                >
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                id="transfer-to"
                label="To"
                error={errors["transfer-to"]}
              >
                <Select
                  id="transfer-to"
                  value={to}
                  aria-invalid={errors["transfer-to"] !== undefined}
                  onBlur={() =>
                    setFieldErrors(["transfer-to"], validateLocations())
                  }
                  onChange={(event) => {
                    setTo(event.target.value as StockLocation);
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next["transfer-to"];
                      return next;
                    });
                  }}
                >
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                id="transfer-date"
                label="Date"
                error={errors["transfer-date"]}
              >
                <Input
                  id="transfer-date"
                  type="date"
                  value={transferredAt}
                  max={businessDate}
                  aria-invalid={errors["transfer-date"] !== undefined}
                  onBlur={() => setFieldErrors(["transfer-date"], validateDate())}
                  onChange={(event) => setTransferredAt(event.target.value)}
                />
              </FormField>
            </div>

            <FormField id="transfer-reason" label="Reason" hint="Optional">
              <Input
                id="transfer-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Restock the shelf"
              />
            </FormField>

            <FormField
              id="transfer-reference"
              label="Reference"
              hint="Auto-generated if left blank"
            >
              <Input
                id="transfer-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Optional"
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
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const available = line.productId
                ? availableUnits(line.productId, from)
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

                    <FormField
                      id={`line-${line.id}-qty`}
                      label="Quantity (units)"
                      error={errors[`line-${line.id}-qty`]}
                      hint={
                        available !== null &&
                        errors[`line-${line.id}-qty`] === undefined &&
                        product
                          ? `Available at ${from.replace(/_/g, " ").toLowerCase()}: ${formatStockUnits(
                              available,
                              product.unitsPerPack,
                              product.packName,
                            )}`
                          : undefined
                      }
                    >
                      <Input
                        id={`line-${line.id}-qty`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={line.quantityUnits}
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
                          updateLine(line.id, {
                            quantityUnits: event.target.value,
                          })
                        }
                        placeholder="e.g. 12"
                      />
                    </FormField>
                  </div>
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
              Record transfer
            </Button>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
