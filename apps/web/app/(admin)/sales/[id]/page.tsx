"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, HandCoins, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  formatLagosDateTime,
  parseMoneyInputToKobo,
  type PaymentMethod,
  type SalePaymentDto,
} from "@fabtyna/shared";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { MoneyInput } from "@/components/money-input";
import { ResponsiveTable } from "@/components/responsive-table";
import type { ResponsiveTableColumn } from "@/components/responsive-table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { accountingApi, salesApi } from "@/lib/api";
import type { SaleLineWithProductDto } from "@/lib/api/sales.api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const id = params.id;

  const sale = useQuery({
    queryKey: queryKeys.sales.detail(id),
    queryFn: () => salesApi.getById(id),
  });

  const [paying, setPaying] = useState(false);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");

  const accounts = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
    enabled: paying,
  });
  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
  }

  const voidMutation = useMutation({
    mutationFn: () => salesApi.void(id),
    onSuccess: () => {
      invalidateAll();
      void sale.refetch();
    },
  });

  const payMutation = useMutation({
    mutationFn: (input: { amountKobo: string; accountId: string }) =>
      salesApi.recordPayment(
        id,
        input.amountKobo,
        new Date().toISOString(),
        input.accountId,
      ),
    onSuccess: () => {
      invalidateAll();
      void sale.refetch();
      setPaying(false);
      setPaymentKobo("");
    },
  });

  if (sale.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" count={2} className="max-w-sm" />
        <Skeleton variant="stat" count={4} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }

  if (sale.isError) {
    const notFound =
      sale.error instanceof ApiError && sale.error.kind === "not-found";
    if (notFound) {
      return (
        <EmptyState
          title="Sale not found"
          description="This sale may have been removed, or the link is incorrect."
          action={
            <Link href="/sales" className={buttonClasses({})}>
              Back to sales
            </Link>
          }
          className="mt-8"
        />
      );
    }
    return (
      <ErrorState
        title="Sale could not be loaded"
        message={toUserMessage(sale.error)}
        onRetry={() => void sale.refetch()}
        className="mt-8"
      />
    );
  }

  if (!sale.data) {
    return (
      <EmptyState
        title="Sale not found"
        description="This sale may have been removed, or the link is incorrect."
        action={
          <Link href="/sales" className={buttonClasses({})}>
            Back to sales
          </Link>
        }
        className="mt-8"
      />
    );
  }

  const s = sale.data;
  const isVoided = s.status === "VOIDED";
  const unpaidKobo = BigInt(s.totalKobo) - BigInt(s.paidKobo);
  const reference = s.reference ?? s.id.slice(0, 8);

  const lineColumns: ResponsiveTableColumn<SaleLineWithProductDto>[] = [
    { header: "Product", render: (line) => line.productName },
    { header: "Unit", render: (line) => line.unit },
    {
      header: "Quantity",
      align: "right",
      render: (line) => (
        <span className="tabular">
          {line.quantity} ({line.quantityUnits} units)
        </span>
      ),
    },
    {
      header: "Unit price",
      align: "right",
      render: (line) => <Money kobo={line.unitPriceKobo} tone="neutral" />,
    },
    {
      header: "Line total",
      align: "right",
      render: (line) => <Money kobo={line.lineTotalKobo} tone="neutral" />,
    },
  ];

  const paymentColumns: ResponsiveTableColumn<SalePaymentDto>[] = [
    {
      header: "Date",
      render: (payment) => formatLagosDateTime(payment.paidAt),
    },
    {
      header: "Amount",
      align: "right",
      render: (payment) => (
        <Money kobo={payment.amountKobo} className="text-success" />
      ),
    },
  ];

  const movementColumns: ResponsiveTableColumn<(typeof s.movements)[number]>[] =
    [
      {
        header: "Product",
        render: (movement) => movement.productId.slice(0, 8),
      },
      {
        header: "Location",
        render: (movement) => movement.location.replace(/_/g, " "),
      },
      {
        header: "Units",
        align: "right",
        render: (movement) => (
          <span className="tabular">{movement.quantityUnits}</span>
        ),
      },
    ];

  async function tryVoid() {
    if (isVoided) return;
    await confirm({
      title: "Void this sale?",
      tone: "danger",
      confirmLabel: "Void sale",
      cancelLabel: "Keep sale",
      description: "This cannot be undone.",
      details: (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Stock sold in this sale will be returned to the shelf/warehouse.
          </li>
          <li>Any customer balance from this sale will be reversed.</li>
          <li>
            The record stays in the history marked <strong>VOIDED</strong>.
          </li>
        </ul>
      ),
      onConfirm: () => voidMutation.mutateAsync(),
      successMessage: `Sale ${reference} voided.`,
    });
  }

  async function submitPayment() {
    setPaymentError("");
    let amountKobo = "";
    try {
      amountKobo = parseMoneyInputToKobo(paymentKobo);
    } catch (cause) {
      setPaymentError(
        cause instanceof Error ? cause.message : "Enter a valid amount.",
      );
      return;
    }
    const selectedAccountId =
      accountId || defaultAccountId(accounts.data ?? [], paymentMethod);
    if (selectedAccountId === "") {
      setPaymentError("Add an active account before recording this payment.");
      return;
    }
    const amount = BigInt(amountKobo);
    if (amount <= 0n) {
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    if (amount > unpaidKobo) {
      setPaymentError(
        `Payment cannot be more than the outstanding balance of ${unpaidKobo}.`,
      );
      return;
    }

    const remaining = unpaidKobo - amount;
    const clearsDebt = remaining === 0n;
    const customerLabel = s.customer?.name ?? s.customerName ?? "Walk-in";

    const ok = await confirm({
      title: "Record payment?",
      confirmLabel: "Record payment",
      details: (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium">{customerLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Amount</span>
            <Money kobo={amount} className="font-medium" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">
              Remaining after payment
            </span>
            <Money kobo={remaining} className="font-medium" />
          </div>
          {clearsDebt && (
            <p className="mt-2 rounded-sm border border-warning/40 bg-warning-surface p-2 text-warning">
              This will clear the debt.
            </p>
          )}
        </div>
      ),
      onConfirm: () =>
        payMutation.mutateAsync({ amountKobo, accountId: selectedAccountId }),
      successMessage: `Payment of ${formatMoneyMessage(amount)} recorded for ${customerLabel}.`,
    });
    if (ok) setPaymentError("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Sale ${reference}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{formatLagosDateTime(s.soldAt)}</span>
            <StatusBadge status={s.status} />
            <Badge tone={s.channel === "RETAIL" ? "info" : "accent"}>
              {s.channel === "RETAIL" ? "Retail" : "Wholesale"}
            </Badge>
          </span>
        }
        actions={
          <>
            <Link
              href="/sales"
              className={buttonClasses({ variant: "secondary" })}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </Link>
            {!isVoided && (
              <>
                <Link
                  href={`/sales/${s.id}/edit`}
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                  Edit sale
                </Link>
                <Button
                  variant="danger"
                  loading={voidMutation.isPending}
                  disabled={network.offline}
                  onClick={() => void tryVoid()}
                >
                  <Ban aria-hidden="true" className="h-4 w-4" />
                  Void sale
                </Button>
              </>
            )}
          </>
        }
      />

      {isVoided && (
        <div
          role="status"
          className="rounded-md border border-danger/30 bg-danger-surface p-4 text-sm text-danger"
        >
          <p className="font-semibold">This sale is voided</p>
          <p className="mt-1">
            Stock and the customer ledger were reversed. The record is kept for
            audit and cannot be edited or paid.
          </p>
        </div>
      )}

      {voidMutation.isError && (
        <ErrorState
          title="Cannot void this sale"
          message={toUserMessage(voidMutation.error)}
        />
      )}

      <div
        className={isVoided ? "space-y-6 opacity-70 saturate-50" : "space-y-6"}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Customer</p>
              <p className="mt-1 font-medium">
                {s.customer?.name ?? s.customerName ?? "Walk-in"}
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="mt-1 font-semibold">
                <Money kobo={s.totalKobo} tone="neutral" />
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Paid</p>
              <p className="mt-1 font-semibold">
                <Money kobo={s.paidKobo} tone="neutral" />
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Outstanding</p>
              <p className="mt-1 font-semibold">
                <Money kobo={unpaidKobo > 0n ? unpaidKobo : 0n} />
              </p>
            </CardBody>
          </Card>
        </div>

        {s.notes && (
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="mt-1 text-sm">{s.notes}</p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Lines" />
          <CardBody>
            <ResponsiveTable
              rows={s.lines}
              columns={lineColumns}
              getKey={(line) => line.id}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Payment history"
          description="Every payment recorded against this sale."
        />
        <CardBody className="space-y-4">
          {s.payments.length === 0 ? (
            <EmptyState
              title="No payments recorded"
              description="Payments recorded against this sale will appear here."
            />
          ) : (
            <ResponsiveTable
              rows={s.payments}
              columns={paymentColumns}
              getKey={(payment) => payment.id}
            />
          )}

          {!isVoided && unpaidKobo > 0n && !paying && (
            <Button
              variant="secondary"
              disabled={network.offline}
              onClick={() => {
                setPaying(true);
                setPaymentMethod("CASH");
                setAccountId("");
                setPaymentKobo((Number(unpaidKobo) / 100).toFixed(2));
                setPaymentError("");
                if (network.offline) {
                  setPaymentError(
                    "You're offline. Payment can't be recorded until you reconnect.",
                  );
                }
              }}
            >
              <HandCoins aria-hidden="true" className="h-4 w-4" />
              Record payment
            </Button>
          )}

          {!isVoided && unpaidKobo > 0n && paying && (
            <div className="space-y-3 rounded-md border border-border p-4">
              <MoneyInput
                id="payment-amount"
                label="Payment amount"
                defaultValueKobo={unpaidKobo.toString()}
                onKoboChange={setPaymentKobo}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="payment-method" label="Payment method">
                  <Select
                    id="payment-method"
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
                  id="payment-account"
                  label="Received into"
                  accounts={accounts.data ?? []}
                  accountId={accountId}
                  onChange={setAccountId}
                  method={paymentMethod}
                  disabled={accounts.isPending || accounts.isError}
                />
              </div>
              {accounts.isError && (
                <p role="alert" className="text-sm text-danger">
                  Accounts could not be loaded: {toUserMessage(accounts.error)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Outstanding balance: <Money kobo={unpaidKobo} tone="neutral" />
              </p>
              {network.offline && (
                <p className="text-sm text-warning">
                  You&rsquo;re offline. Changes can&rsquo;t be saved until you
                  reconnect.
                </p>
              )}
              {paymentError && (
                <p role="alert" className="text-sm text-danger">
                  {paymentError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  loading={payMutation.isPending}
                  disabled={network.offline}
                  onClick={() => void submitPayment()}
                >
                  <HandCoins aria-hidden="true" className="h-4 w-4" />
                  Record payment
                </Button>
                <Button
                  variant="secondary"
                  disabled={payMutation.isPending}
                  onClick={() => {
                    setPaying(false);
                    setPaymentError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Stock movements" />
        <CardBody>
          {s.movements.length === 0 ? (
            <EmptyState
              title="No stock movements"
              description="Movements generated by this sale will appear here."
            />
          ) : (
            <ResponsiveTable
              rows={s.movements}
              columns={movementColumns}
              getKey={(movement) => movement.id}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function formatMoneyMessage(kobo: bigint): string {
  const naira = kobo / 100n;
  const fraction = (kobo % 100n).toString().padStart(2, "0");
  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${grouped}.${fraction}`;
}
