"use client";

import { Suspense, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, HandCoins, Pencil, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  formatLagosDateTime,
  formatNaira,
  type PaymentMethod,
} from "@fabtyna/shared";
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
import { accountingApi, purchasesApi } from "@/lib/api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import {
  purchaseBalanceDueKobo,
  type PurchaseLineWithProductDto,
  type SupplierPaymentDetailDto,
} from "@/lib/api/purchases.api";
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
      This purchase replaces an earlier one that was voided.{" "}
      <Link
        href={`/purchases/${replaced}`}
        className="font-medium text-primary hover:underline"
      >
        View the voided purchase
      </Link>
    </div>
  );
}

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const id = params.id;
  const paymentsRef = useRef<HTMLDivElement | null>(null);

  const purchase = useQuery({
    queryKey: queryKeys.purchases.detail(id),
    queryFn: () => purchasesApi.getById(id),
  });

  const [paying, setPaying] = useState(false);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");

  const [reversing, setReversing] = useState<SupplierPaymentDetailDto | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");

  const payFlow = useWriteFlow();
  const reverseFlow = useWriteFlow();
  const voidFlow = useWriteFlow();

  // Last submitted write, so "Retry safely" re-sends the same body and key.
  const retryPay = useRef<(() => Promise<void>) | null>(null);
  const retryReverse = useRef<(() => Promise<void>) | null>(null);
  const retryVoid = useRef<(() => Promise<void>) | null>(null);

  const accounts = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listPaymentAccounts(),
    enabled: paying,
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.payables.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
  }

  if (purchase.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" count={2} className="max-w-sm" />
        <Skeleton variant="stat" count={4} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }

  if (purchase.isError) {
    const notFound =
      purchase.error instanceof ApiError && purchase.error.kind === "not-found";
    if (notFound) {
      return (
        <EmptyState
          title="Purchase not found"
          description="This purchase may have been removed, or the link is incorrect."
          action={
            <Link href="/purchases" className={buttonClasses({})}>
              Back to purchases
            </Link>
          }
          className="mt-8"
        />
      );
    }
    return (
      <ErrorState
        title="Purchase could not be loaded"
        message={toUserMessage(purchase.error)}
        onRetry={() => void purchase.refetch()}
        className="mt-8"
      />
    );
  }

  if (!purchase.data) {
    return (
      <EmptyState
        title="Purchase not found"
        description="This purchase may have been removed, or the link is incorrect."
        action={
          <Link href="/purchases" className={buttonClasses({})}>
            Back to purchases
          </Link>
        }
        className="mt-8"
      />
    );
  }

  const p = purchase.data;
  const isVoided = p.status === "VOIDED";
  const balanceDue = purchaseBalanceDueKobo(p);
  const livePayments =
    p.livePaymentsKobo ??
    p.payments
      .reduce(
        (sum, payment) =>
          payment.reversed ? sum : sum + BigInt(payment.amountKobo),
        0n,
      )
      .toString();
  const reference = p.reference ?? p.id.slice(0, 8);
  const supplierLabel = p.supplier?.name ?? "No supplier";
  const checkHref = `/purchases?q=${encodeURIComponent(reference)}`;
  const canReverse = !isVoided;

  const selectedAccountId =
    accountId || defaultAccountId(accounts.data ?? [], paymentMethod);
  const selectedAccount = (accounts.data ?? []).find(
    (a) => a.id === selectedAccountId,
  ) as ({ name: string; balanceKobo?: string } | undefined);
  const accountBalance =
    selectedAccount?.balanceKobo !== undefined
      ? BigInt(selectedAccount.balanceKobo)
      : null;
  const typedAmount = /^[1-9]\d*$/.test(paymentKobo) ? BigInt(paymentKobo) : 0n;
  const overdrawWarning =
    accountBalance !== null && typedAmount > accountBalance
      ? `${selectedAccount?.name} holds ${formatNaira(accountBalance)}, less than this payment of ${formatNaira(typedAmount)}. The server will refuse it unless you record income or reconcile first.`
      : "";

  const columns: ResponsiveTableColumn<PurchaseLineWithProductDto>[] = [
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
      header: "Unit cost",
      align: "right",
      render: (line) => <Money kobo={line.unitCostKobo} tone="neutral" />,
    },
    {
      header: "Line total",
      align: "right",
      render: (line) => <Money kobo={line.lineTotalKobo} tone="neutral" />,
    },
  ];

  const paymentColumns: ResponsiveTableColumn<SupplierPaymentDetailDto>[] = [
    { header: "Date", render: (x) => formatLagosDateTime(x.paidAt) },
    { header: "Method", render: (x) => x.method },
    { header: "Account", render: (x) => x.accountName ?? "—" },
    {
      header: "Amount",
      align: "right",
      render: (x) => (
        <Money
          kobo={x.amountKobo}
          className={x.reversed ? "line-through" : undefined}
          tone="neutral"
        />
      ),
    },
    {
      header: "Status",
      render: (x) =>
        x.reversed ? <Badge tone="danger">Reversed</Badge> : "Live",
    },
    ...(canReverse
      ? [
          {
            header: "",
            align: "right" as const,
            render: (x: SupplierPaymentDetailDto) =>
              x.reversed ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={network.offline || reverseFlow.pending}
                  onClick={() => {
                    setReversing(x);
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

  async function tryVoid() {
    if (isVoided) return;
    const ok = await confirm({
      title: "Void this purchase?",
      tone: "danger",
      confirmLabel: "Void purchase",
      cancelLabel: "Keep purchase",
      description: "This cannot be undone.",
      details: (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Stock received in this purchase will be removed again.</li>
          <li>The supplier ledger entry from this purchase will be reversed.</li>
          <li>
            Voiding is refused while any supplier payment is live. Reverse the
            payments first.
          </li>
          <li>
            The record stays in the history marked <strong>VOIDED</strong>.
          </li>
        </ul>
      ),
    });
    if (!ok) return;
    const submit = async () => {
      const result = await voidFlow.run((key) => purchasesApi.void(id, key));
      if (result) {
        invalidateAll();
        void purchase.refetch();
        toast.success(`Purchase ${reference} voided.`);
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
    if (selectedAccountId === "") {
      setPaymentError("Choose an active account to pay from.");
      return;
    }
    const amount = BigInt(amountKobo);
    if (amount > balanceDue) {
      setPaymentError("Payment cannot be more than the balance due.");
      return;
    }
    const accountName = selectedAccount?.name ?? "the selected account";

    const ok = await confirm({
      title: "Record supplier payment?",
      confirmLabel: "Record payment",
      details: (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Supplier</span>
            <span className="font-medium">{supplierLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Amount</span>
            <Money kobo={amount} className="font-medium" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Paid from</span>
            <span className="font-medium">{accountName}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Remaining after</span>
            <Money kobo={balanceDue - amount} className="font-medium" />
          </div>
        </div>
      ),
    });
    if (!ok) return;

    const paidAt = new Date().toISOString();
    const method = paymentMethod;
    const submit = async () => {
      const result = await payFlow.run((key) =>
        purchasesApi.recordPayment(
          id,
          amountKobo,
          paidAt,
          method,
          selectedAccountId,
          undefined,
          key,
        ),
      );
      if (result) {
        invalidateAll();
        void purchase.refetch();
        setPaying(false);
        setPaymentKobo("");
        toast.success("Supplier payment recorded.");
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
      title: "Reverse this supplier payment?",
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
            The money returns to the account and you owe the supplier again.
          </p>
        </div>
      ),
    });
    if (!ok) return;

    const submit = async () => {
      const result = await reverseFlow.run((key) =>
        purchasesApi.reversePayment(id, payment.id, trimmed, key),
      );
      if (result) {
        invalidateAll();
        void purchase.refetch();
        setReversing(null);
        setReason("");
        toast.success("Supplier payment reversed.");
      }
    };
    retryReverse.current = submit;
    await submit();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Purchase ${reference}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{formatLagosDateTime(p.purchasedAt)}</span>
            <StatusBadge status={p.status} />
          </span>
        }
        actions={
          <>
            <Link
              href="/purchases"
              className={buttonClasses({ variant: "secondary" })}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </Link>
            {!isVoided && (
              <>
                <Link
                  href={`/purchases/${p.id}/edit`}
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                  Amend purchase
                </Link>
                <Button
                  variant="danger"
                  loading={voidFlow.pending}
                  disabled={network.offline}
                  onClick={() => void tryVoid()}
                >
                  <Ban aria-hidden="true" className="h-4 w-4" />
                  Void purchase
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
          <p className="font-semibold">This purchase is voided</p>
          <p className="mt-1">
            Stock movements and the supplier ledger entry were reversed. The
            record is kept for audit and cannot be amended.
          </p>
        </div>
      )}

      <WriteFlowStatus
        flow={voidFlow}
        onRetry={() => void retryVoid.current?.()}
        checkHref={checkHref}
        checkLabel="Check recent purchases"
        onReverseAction={() => {
          voidFlow.reset();
          paymentsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }}
        reverseActionLabel="Go to payments"
      />

      <div
        className={isVoided ? "space-y-6 opacity-70 saturate-50" : "space-y-6"}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Supplier</p>
              <p className="mt-1 font-medium">{supplierLabel}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="mt-1 font-semibold">
                <Money kobo={p.totalKobo} tone="neutral" />
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
                <Money kobo={balanceDue} />
              </p>
            </CardBody>
          </Card>
        </div>

        {p.notes && (
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="mt-1 text-sm">{p.notes}</p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Lines" />
          <CardBody>
            <ResponsiveTable
              rows={p.lines}
              columns={columns}
              getKey={(line) => line.id}
            />
          </CardBody>
        </Card>
      </div>

      <div ref={paymentsRef} className="scroll-mt-20">
        <Card>
          <CardHeader
            title="Supplier payments"
            description="Every payment made to the supplier for this purchase, including money paid at receipt."
          />
          <CardBody className="space-y-4">
            {p.payments.length === 0 ? (
              <EmptyState
                title="No payments recorded"
                description="Payments made against this purchase will appear here."
              />
            ) : (
              <ResponsiveTable
                rows={p.payments}
                columns={paymentColumns}
                getKey={(x) => x.id}
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
                  checkLabel="Check recent purchases"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    loading={reverseFlow.pending}
                    disabled={
                      network.offline || reverseFlow.status === "unknown"
                    }
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
                Pay supplier
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
                    label="Paid from"
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
                {overdrawWarning && (
                  <p role="status" className="text-sm text-warning">
                    {overdrawWarning}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Balance due: <Money kobo={balanceDue} tone="neutral" />
                </p>
                {paymentError && (
                  <p role="alert" className="text-sm text-danger">
                    {paymentError}
                  </p>
                )}
                <WriteFlowStatus
                  flow={payFlow}
                  onRetry={() => void retryPay.current?.()}
                  checkHref={checkHref}
                  checkLabel="Check recent purchases"
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

      {p.moneyEntries &&
        (p.moneyEntries.supplierLedger.length > 0 ||
          p.moneyEntries.account.length > 0) && (
          <Card>
            <CardHeader
              title="Money entries"
              description="The supplier ledger and account entries this purchase created."
            />
            <CardBody className="space-y-4">
              {p.moneyEntries.supplierLedger.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Supplier ledger</p>
                  <ResponsiveTable
                    rows={p.moneyEntries.supplierLedger}
                    getKey={(entry) => entry.id}
                    columns={[
                      {
                        header: "Date",
                        render: (entry) => formatLagosDateTime(entry.occurredAt),
                      },
                      { header: "Type", render: (entry) => entry.type },
                      {
                        header: "Amount",
                        align: "right",
                        render: (entry) => (
                          <Money kobo={entry.amountKobo} tone="neutral" />
                        ),
                      },
                      {
                        header: "Reverses",
                        render: (entry) =>
                          entry.reversesEntryId
                            ? entry.reversesEntryId.slice(0, 8)
                            : "—",
                      },
                    ]}
                  />
                </div>
              )}
              {p.moneyEntries.account.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Account entries</p>
                  <ResponsiveTable
                    rows={p.moneyEntries.account}
                    getKey={(entry) => entry.id}
                    columns={[
                      {
                        header: "Date",
                        render: (entry) => formatLagosDateTime(entry.occurredAt),
                      },
                      { header: "Account", render: (entry) => entry.accountName },
                      { header: "Type", render: (entry) => entry.type },
                      {
                        header: "Amount",
                        align: "right",
                        render: (entry) => (
                          <Money kobo={entry.amountKobo} tone="neutral" />
                        ),
                      },
                      {
                        header: "Reverses",
                        render: (entry) =>
                          entry.reversesEntryId
                            ? entry.reversesEntryId.slice(0, 8)
                            : "—",
                      },
                    ]}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        )}
    </div>
  );
}
