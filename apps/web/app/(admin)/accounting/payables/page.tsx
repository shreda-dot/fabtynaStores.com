"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  FileText,
  HandCoins,
  Plus,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import {
  createLagosDateTime,
  formatLagosDate,
  formatNaira,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { MoneyInput } from "@/components/money-input";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Select, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { accountingApi, payablesApi, purchasesApi } from "@/lib/api";
import type { PayableLineDto } from "@/lib/api/payables.api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "OTHER", label: "Other" },
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

function lineStatusLabel(line: PayableLineDto): string {
  if (line.overdue) return "Overdue";
  if (line.status === "PAID") return "Paid";
  if (line.status === "PARTIAL") return "Partial";
  return "Unpaid";
}

export default function PayablesPage() {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const businessDate = useLagosBusinessDate();

  const payablesQuery = useQuery({
    queryKey: queryKeys.payables.outstanding,
    queryFn: () => payablesApi.listOutstanding(),
  });
  const accountsQuery = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [payingPurchaseId, setPayingPurchaseId] = useState<string | null>(null);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => businessDate);
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const submitting = useRef(false);

  const payMutation = useMutation({
    mutationFn: (input: {
      purchaseId: string;
      amountKobo: string;
      paidAt: string;
      method: PaymentMethod;
      accountId: string;
      note: string | null;
    }) =>
      purchasesApi.recordPayment(
        input.purchaseId,
        input.amountKobo,
        input.paidAt,
        input.method,
        input.accountId,
        input.note ?? undefined,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payables.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.all,
      });
      setPayingPurchaseId(null);
      setPaymentKobo("");
      setAccountId("");
      setPaymentNote("");
      setPaymentError("");
    },
  });

  function toggle(supplierId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  }

  function startPayment(line: PayableLineDto) {
    setPayingPurchaseId(line.purchaseId);
    setPaymentKobo(line.balanceKobo);
    setPaymentMethod("CASH");
    setAccountId("");
    setPaymentDate(businessDate);
    setPaymentNote("");
    setPaymentError("");
  }

  function cancelPayment() {
    setPayingPurchaseId(null);
    setPaymentError("");
  }

  async function submitPayment(line: PayableLineDto, supplierName: string) {
    if (submitting.current || payMutation.isPending) return;
    payMutation.reset();
    setPaymentError("");

    if (paymentKobo.trim() === "" || !/^[0-9]+$/.test(paymentKobo)) {
      setPaymentError("Enter a valid amount.");
      return;
    }
    const amount = BigInt(paymentKobo);
    const balance = BigInt(line.balanceKobo);
    if (amount <= 0n) {
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    if (amount > balance) {
      setPaymentError(
        `Payment cannot be more than the outstanding balance of ${formatNaira(balance)}.`,
      );
      return;
    }
    const selectedAccountId =
      accountId || defaultAccountId(accountsQuery.data ?? [], paymentMethod);
    if (selectedAccountId === "") {
      setPaymentError("Add an active account before recording this payment.");
      return;
    }
    if (accountsQuery.isError) {
      setPaymentError(`Accounts could not be loaded: ${toUserMessage(accountsQuery.error)}`);
      return;
    }
    if (paymentDate === "") {
      setPaymentError("Choose the date the payment was made.");
      return;
    }
    if (paymentDate > businessDate) {
      setPaymentError("The payment date cannot be in the future.");
      return;
    }

    const remaining = balance - amount;
    const clearsPurchase = remaining === 0n;

    submitting.current = true;
    try {
      await confirm({
        title: "Record this supplier payment?",
        description: "Confirm before the payment is saved.",
        confirmLabel: "Record payment",
        successMessage: `Payment of ${formatNaira(amount)} recorded for ${supplierName}.`,
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Supplier">{supplierName}</SummaryRow>
            <SummaryRow label="Amount">
              <Money kobo={amount} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Balance after">
              <Money kobo={remaining} />
            </SummaryRow>
            {clearsPurchase && (
              <p className="rounded-sm border border-success/30 bg-success-surface px-2 py-1 text-xs text-success">
                This will clear this purchase.
              </p>
            )}
          </dl>
        ),
        onConfirm: () =>
          payMutation.mutateAsync({
            purchaseId: line.purchaseId,
            amountKobo: paymentKobo,
            paidAt: createLagosDateTime(paymentDate).toISOString(),
            method: paymentMethod,
            accountId: selectedAccountId,
            note: paymentNote.trim() === "" ? null : paymentNote.trim(),
          }),
      });
    } finally {
      submitting.current = false;
    }
  }

  const groups = payablesQuery.data ?? [];
  const totalOwed = groups.reduce((sum, g) => sum + BigInt(g.balanceKobo), 0n);
  const totalOverdue = groups.reduce(
    (sum, g) => sum + BigInt(g.overdueKobo),
    0n,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payables"
        description="Suppliers you still owe money to, from purchases bought on credit."
        actions={
          <Link
            href="/purchases/new"
            className={buttonClasses({ variant: "secondary" })}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New purchase
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total owed"
          value={
            <Money
              kobo={totalOwed}
              tone={totalOwed > 0n ? "auto" : "neutral"}
            />
          }
          tone={totalOwed > 0n ? "danger" : "default"}
          icon={HandCoins}
        />
        <StatCard
          label="Suppliers owed"
          value={groups.length}
          icon={FileText}
        />
        <StatCard
          label="Overdue"
          value={
            <Money
              kobo={totalOverdue}
              tone={totalOverdue > 0n ? "auto" : "neutral"}
            />
          }
          tone={totalOverdue > 0n ? "warning" : "default"}
          icon={TriangleAlert}
          hint={totalOverdue > 0n ? "Past the agreed due date" : undefined}
        />
      </div>

      {payablesQuery.isPending ? (
        <Skeleton variant="row" count={4} />
      ) : payablesQuery.isError ? (
        <ErrorState
          title="Payables could not be loaded"
          message={toUserMessage(payablesQuery.error)}
          onRetry={() => void payablesQuery.refetch()}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="Nothing owed to suppliers"
          description="Every purchase on record is fully paid."
          action={
            <Link
              href="/purchases"
              className={buttonClasses({ variant: "secondary" })}
            >
              View purchases
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const isOpen = expanded.has(group.supplierId);
            const overdue = BigInt(group.overdueKobo) > 0n;
            return (
              <Card key={group.supplierId}>
                <button
                  type="button"
                  onClick={() => toggle(group.supplierId)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-section font-semibold text-card-foreground">
                        {group.supplierName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.purchases.length === 1
                          ? "1 unpaid purchase"
                          : `${group.purchases.length} unpaid purchases`}
                        {overdue && (
                          <span className="ml-2 text-warning">
                            Overdue balance
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total owed</p>
                    <p className="text-lg font-bold text-danger">
                      <Money kobo={group.balanceKobo} />
                    </p>
                  </div>
                </button>

                {isOpen && (
                  <CardBody className="space-y-3 border-t border-border">
                    {group.purchases.map((line) => {
                      const isPaying = payingPurchaseId === line.purchaseId;
                      return (
                        <div
                          key={line.purchaseId}
                          className="rounded-md border border-border bg-background/50 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {line.reference ??
                                    line.purchaseId.slice(0, 8)}
                                </span>
                                <StatusBadge status={lineStatusLabel(line)} />
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatLagosDate(line.purchasedAt)}
                                {line.dueDate
                                  ? ` · due ${formatLagosDate(line.dueDate)}`
                                  : ""}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {line.itemsSummary}
                              </p>
                            </div>
                            <div className="text-right text-sm">
                              <p className="font-medium text-foreground">
                                <Money kobo={line.balanceKobo} />
                                <span className="text-xs font-normal text-muted-foreground">
                                  {" owed of "}
                                  <Money kobo={line.totalKobo} tone="neutral" />
                                </span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Paid{" "}
                                <Money kobo={line.paidKobo} tone="neutral" />
                              </p>
                            </div>
                          </div>

                          {isPaying ? (
                            <div className="mt-3 space-y-3 border-t border-border pt-3">
                              <MoneyInput
                                key={`pay-${line.balanceKobo}`}
                                id={`pay-${line.purchaseId}`}
                                label="Payment amount"
                                defaultValueKobo={line.balanceKobo}
                                onKoboChange={setPaymentKobo}
                              />
                              <div className="grid gap-3 sm:grid-cols-2">
                                <FormField
                                  id={`pay-method-${line.purchaseId}`}
                                  label="Method"
                                >
                                  <Select
                                    id={`pay-method-${line.purchaseId}`}
                                    value={paymentMethod}
                                    onChange={(event) =>
                                      setPaymentMethod(
                                        event.target.value as PaymentMethod,
                                      )
                                    }
                                  >
                                    {PAYMENT_METHODS.map((method) => (
                                      <option
                                        key={method.value}
                                        value={method.value}
                                      >
                                        {method.label}
                                      </option>
                                    ))}
                                  </Select>
                                </FormField>
                                <AccountSelect
                                  id={`pay-account-${line.purchaseId}`}
                                  label="Paid from"
                                  accounts={accountsQuery.data ?? []}
                                  accountId={accountId}
                                  onChange={setAccountId}
                                  method={paymentMethod}
                                  disabled={accountsQuery.isPending || accountsQuery.isError}
                                />
                                <DateFilter
                                  id={`pay-date-${line.purchaseId}`}
                                  label="Date paid"
                                  value={paymentDate}
                                  onChange={setPaymentDate}
                                  max={businessDate}
                                />
                              </div>
                              <FormField
                                id={`pay-note-${line.purchaseId}`}
                                label="Note (optional)"
                              >
                                <Textarea
                                  id={`pay-note-${line.purchaseId}`}
                                  rows={2}
                                  value={paymentNote}
                                  onChange={(event) =>
                                    setPaymentNote(event.target.value)
                                  }
                                />
                              </FormField>

                              {paymentError && (
                                <p role="alert" className="text-sm text-danger">
                                  {paymentError}
                                </p>
                              )}
                              {payMutation.isError && (
                                <p role="alert" className="text-sm text-danger">
                                  {toUserMessage(payMutation.error)}
                                </p>
                              )}
                              {network.offline && (
                                <p className="text-sm text-warning">
                                  You&rsquo;re offline. Changes can&rsquo;t be
                                  saved until you reconnect.
                                </p>
                              )}

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  onClick={() =>
                                    void submitPayment(line, group.supplierName)
                                  }
                                  loading={payMutation.isPending}
                                  disabled={network.offline}
                                >
                                  <HandCoins
                                    aria-hidden="true"
                                    className="h-4 w-4"
                                  />
                                  Confirm payment
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={cancelPayment}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="mt-3 border-primary text-primary hover:bg-primary/10"
                              onClick={() => startPayment(line)}
                            >
                              Record payment
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </CardBody>
                )}
              </Card>
            );
          })}
        </div>
      )}
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
