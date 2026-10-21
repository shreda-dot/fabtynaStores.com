"use client";

import { Suspense, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, HandCoins, Pencil, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatLagosDateTime, type PaymentMethod } from "@fabtyna/shared";
import {
  AccountSelect,
  defaultAccountId,
} from "@/components/accounting/account-select";
import { MoneyInput } from "@/components/money-input";
import { ResponsiveTable } from "@/components/responsive-table";
import type { ResponsiveTableColumn } from "@/components/responsive-table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Select, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { accountingApi, isMockApiMode, salesApi } from "@/lib/api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import {
  saleBalanceDueKobo,
  type SaleLineWithProductDto,
  type SalePaymentDetailDto,
} from "@/lib/api/sales.api";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

const REASON_MAX = 500;

function ReplacedBanner() {
  const replaced = useSearchParams().get("replaced");
  if (!replaced) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-border bg-muted p-4 text-sm"
    >
      This sale replaces an earlier one that was voided.{" "}
      <Link
        href={`/sales/${replaced}`}
        className="font-medium text-primary hover:underline"
      >
        View the voided sale
      </Link>
    </div>
  );
}

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const id = params.id;
  const paymentsRef = useRef<HTMLDivElement | null>(null);

  const sale = useQuery({
    queryKey: queryKeys.sales.detail(id),
    queryFn: () => salesApi.getById(id),
  });

  const [paying, setPaying] = useState(false);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");

  const [reversing, setReversing] = useState<SalePaymentDetailDto | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");

  const payFlow = useWriteFlow();
  const reverseFlow = useWriteFlow();
  const voidFlow = useWriteFlow();

  // The last submitted write, kept so "Retry safely" re-sends exactly the same
  // body (same paidAt, same reason) under the same idempotency key.
  const retryPay = useRef<(() => Promise<void>) | null>(null);
  const retryReverse = useRef<(() => Promise<void>) | null>(null);
  const retryVoid = useRef<(() => Promise<void>) | null>(null);

  const accounts = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listPaymentAccounts(),
    enabled: paying,
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.debtors.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
  }

  function scrollToPayments() {
    paymentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
  const balanceDue = BigInt(saleBalanceDueKobo(s));
  const livePayments =
    s.livePaymentsKobo ?? s.payments.reduce(
      (sum, p) => (p.reversed ? sum : sum + BigInt(p.amountKobo)),
      0n,
    ).toString();
  const reference = s.reference ?? s.id.slice(0, 8);
  const customerLabel = s.customer?.name ?? s.customerName ?? "Walk-in";
  const checkHref = `/sales?q=${encodeURIComponent(reference)}`;
  // Reversing a payment needs the real API and a sale with a customer.
  const canReverse = !isMockApiMode && !isVoided && s.customer !== null;

  const lineColumns: ResponsiveTableColumn<SaleLineWithProductDto>[] = [
    { header: "Product", render: (line) => line.productName },
    { header: "Unit", render: (line) => line.unit },
    {
      header: "Location",
      render: (line) =>
        line.location ? line.location.replace(/_/g, " ") : "—",
    },
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

  const paymentColumns: ResponsiveTableColumn<SalePaymentDetailDto>[] = [
    {
      header: "Date",
      render: (payment) => formatLagosDateTime(payment.paidAt),
    },
    {
      header: "Account",
      render: (payment) => payment.accountName ?? "—",
    },
    {
      header: "Amount",
      align: "right",
      render: (payment) => (
        <Money
          kobo={payment.amountKobo}
          className={payment.reversed ? "line-through" : "text-success"}
          tone={payment.reversed ? "neutral" : undefined}
        />
      ),
    },
    {
      header: "Status",
      render: (payment) =>
        payment.reversed ? <Badge tone="danger">Reversed</Badge> : "Live",
    },
    ...(canReverse
      ? [
          {
            header: "",
            align: "right" as const,
            render: (payment: SalePaymentDetailDto) =>
              payment.reversed ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={network.offline || reverseFlow.pending}
                  onClick={() => {
                    setReversing(payment);
                    setReason("");
                    setReasonError("");
                    reverseFlow.edit();
                  }}
                >
                  <Undo2 aria-hidden="true" className="h-4 w-4" />
                  Reverse
                </Button>
              ),
          },
        ]
      : []),
  ];

  const movementColumns: ResponsiveTableColumn<(typeof s.movements)[number]>[] =
    [
      {
        header: "Product",
        render: (movement) =>
          s.lines.find((line) => line.productId === movement.productId)?.productName ??
          movement.productId.slice(0, 8),
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
    const ok = await confirm({
      title: "Void this sale?",
      tone: "danger",
      confirmLabel: "Void sale",
      cancelLabel: "Keep sale",
      description: "This cannot be undone.",
      details: (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Stock sold in this sale will be returned.</li>
          <li>Any customer balance from this sale will be reversed.</li>
          <li>Money taken up front is put back in its account.</li>
          <li>
            The record stays in the history marked <strong>VOIDED</strong>.
          </li>
        </ul>
      ),
    });
    if (!ok) return;
    const submit = async () => {
      const result = await voidFlow.run((key) => salesApi.void(id, key));
      if (result) {
        invalidateAll();
        void sale.refetch();
        toast.success(`Sale ${reference} voided.`);
      }
    };
    retryVoid.current = submit;
    await submit();
  }

  async function submitPayment() {
    setPaymentError("");
    const amountKobo = paymentKobo;
    if (!/^[1-9]\d*$/.test(amountKobo)) {
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    const selectedAccountId =
      accountId || defaultAccountId(accounts.data ?? [], paymentMethod);
    if (selectedAccountId === "") {
      setPaymentError("Choose an active account for this payment.");
      return;
    }
    const amount = BigInt(amountKobo);
    if (amount > balanceDue) {
      setPaymentError("Payment cannot be more than the balance due.");
      return;
    }
    const remaining = balanceDue - amount;
    const accountName =
      (accounts.data ?? []).find((a) => a.id === selectedAccountId)?.name ??
      "the selected account";

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
            <span className="text-muted-foreground">Received into</span>
            <span className="font-medium">{accountName}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">
              Remaining after payment
            </span>
            <Money kobo={remaining} className="font-medium" />
          </div>
          {remaining === 0n && (
            <p className="mt-2 rounded-sm border border-warning/40 bg-warning-surface p-2 text-warning">
              This will clear the debt.
            </p>
          )}
        </div>
      ),
    });
    if (!ok) return;

    const paidAt = new Date().toISOString();
    const submit = async () => {
      const result = await payFlow.run((key) =>
        salesApi.recordPayment(id, amountKobo, paidAt, selectedAccountId, key),
      );
      if (result) {
        invalidateAll();
        void sale.refetch();
        setPaying(false);
        setPaymentKobo("");
        toast.success("Payment recorded.");
      }
    };
    retryPay.current = submit;
    await submit();
  }

  async function submitReverse() {
    if (!reversing) return;
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > REASON_MAX) {
      setReasonError(`Give a reason of 1 to ${REASON_MAX} characters.`);
      return;
    }
    setReasonError("");
    const payment = reversing;
    const ok = await confirm({
      title: "Reverse this payment?",
      tone: "danger",
      confirmLabel: "Reverse payment",
      details: (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Amount</span>
            <Money kobo={payment.amountKobo} className="font-medium" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Account</span>
            <span className="font-medium">{payment.accountName ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Paid on</span>
            <span className="font-medium">
              {formatLagosDateTime(payment.paidAt)}
            </span>
          </div>
          <p className="text-muted-foreground">
            The money leaves the account and the customer owes it again.
          </p>
        </div>
      ),
    });
    if (!ok) return;

    const submit = async () => {
      const result = await reverseFlow.run((key) =>
        salesApi.reversePayment(id, payment.id, trimmed, key),
      );
      if (result) {
        invalidateAll();
        void sale.refetch();
        setReversing(null);
        setReason("");
        toast.success("Payment reversed.");
      }
    };
    retryReverse.current = submit;
    await submit();
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
                  Amend sale
                </Link>
                <Button
                  variant="danger"
                  loading={voidFlow.pending}
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

      <Suspense fallback={null}>
        <ReplacedBanner />
      </Suspense>

      {isVoided && (
        <div
          role="status"
          className="rounded-md border border-danger/30 bg-danger-surface p-4 text-sm text-danger"
        >
          <p className="font-semibold">This sale is voided</p>
          <p className="mt-1">
            Stock, the customer ledger and any account money were reversed. The
            record is kept for audit and cannot be amended or paid.
          </p>
        </div>
      )}

      <WriteFlowStatus
        flow={voidFlow}
        onRetry={() => void retryVoid.current?.()}
        checkHref={checkHref}
        checkLabel="Check recent sales"
        onReverseAction={() => {
          voidFlow.reset();
          scrollToPayments();
        }}
        reverseActionLabel="Go to payments"
      />

      <div
        className={isVoided ? "space-y-6 opacity-70 saturate-50" : "space-y-6"}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Customer</p>
              <p className="mt-1 font-medium">{customerLabel}</p>
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
              <p className="text-sm text-muted-foreground">Live payments</p>
              <p className="mt-1 font-semibold">
                <Money kobo={livePayments} tone="neutral" />
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Balance due</p>
              <p className="mt-1 font-semibold">
                <Money kobo={balanceDue > 0n ? balanceDue : 0n} />
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

      <div ref={paymentsRef} className="scroll-mt-20">
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

            {reversing && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <p className="text-sm font-medium">
                  Reverse the payment of{" "}
                  <Money kobo={reversing.amountKobo} tone="neutral" />
                </p>
                <FormField
                  id="reverse-reason"
                  label="Reason"
                  error={reasonError || undefined}
                >
                  <Textarea
                    id="reverse-reason"
                    rows={3}
                    maxLength={REASON_MAX}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      reverseFlow.edit();
                    }}
                  />
                </FormField>
                <WriteFlowStatus
                  flow={reverseFlow}
                  onRetry={() => void retryReverse.current?.()}
                  checkHref={checkHref}
                  checkLabel="Check recent sales"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    loading={reverseFlow.pending}
                    disabled={network.offline || reverseFlow.status === "unknown"}
                    onClick={() => void submitReverse()}
                  >
                    Reverse payment
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={reverseFlow.pending}
                    onClick={() => setReversing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {!isVoided && balanceDue > 0n && !paying && (
              <Button
                variant="secondary"
                disabled={network.offline}
                onClick={() => {
                  setPaying(true);
                  setPaymentMethod("CASH");
                  setAccountId("");
                  setPaymentKobo(balanceDue.toString());
                  setPaymentError("");
                  payFlow.edit();
                }}
              >
                <HandCoins aria-hidden="true" className="h-4 w-4" />
                Record payment
              </Button>
            )}

            {!isVoided && balanceDue > 0n && paying && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <MoneyInput
                  id="payment-amount"
                  label="Payment amount"
                  defaultValueKobo={balanceDue.toString()}
                  onKoboChange={(value) => {
                    setPaymentKobo(value);
                    payFlow.edit();
                  }}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField id="payment-method" label="Payment method">
                    <Select
                      id="payment-method"
                      value={paymentMethod}
                      onChange={(event) => {
                        setPaymentMethod(event.target.value as PaymentMethod);
                        setAccountId("");
                        payFlow.edit();
                      }}
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
                    onChange={(value) => {
                      setAccountId(value);
                      payFlow.edit();
                    }}
                    method={paymentMethod}
                    disabled={accounts.isPending || accounts.isError}
                  />
                </div>
                {accounts.isError && (
                  <p role="alert" className="text-sm text-danger">
                    Accounts could not be loaded:{" "}
                    {toUserMessage(accounts.error)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Balance due: <Money kobo={balanceDue} tone="neutral" />
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
                <WriteFlowStatus
                  flow={payFlow}
                  onRetry={() => void retryPay.current?.()}
                  checkHref={checkHref}
                  checkLabel="Check recent sales"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    loading={payFlow.pending}
                    disabled={network.offline || payFlow.status === "unknown"}
                    onClick={() => void submitPayment()}
                  >
                    <HandCoins aria-hidden="true" className="h-4 w-4" />
                    Record payment
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={payFlow.pending}
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
      </div>

      {s.movements.length > 0 && (
        <Card>
          <CardHeader title="Stock movements" />
          <CardBody>
            <ResponsiveTable
              rows={s.movements}
              columns={movementColumns}
              getKey={(movement) => movement.id}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
