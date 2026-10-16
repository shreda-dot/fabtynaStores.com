"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Landmark, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  createLagosDateTime,
  formatLagosDate,
  formatLagosDateTime,
  formatNaira,
  getLagosBusinessDate,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { loansApi } from "@/lib/api";
import type { LoanDetailDto } from "@/lib/api/loans.api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";

const LEDGER_LABEL: Record<string, string> = {
  DISBURSEMENT: "Disbursement",
  CHARGE: "Charge",
  REPAYMENT: "Repayment",
};

export default function LoanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const loan = useQuery({
    queryKey: queryKeys.loans.detail(id),
    queryFn: () => loansApi.getById(id),
  });

  if (loan.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton variant="text" count={2} className="max-w-xs" />
        <Skeleton variant="card" count={3} />
      </div>
    );
  }

  if (loan.isError) {
    const notFound =
      loan.error instanceof ApiError && loan.error.kind === "not-found";
    if (notFound) {
      return (
        <div className="mx-auto max-w-4xl">
          <EmptyState
            title="Loan not found"
            description="This loan may have been removed, or the link is incorrect."
            action={
              <Link
                href="/accounting/loans"
                className={buttonClasses({ variant: "secondary" })}
              >
                Back to loans
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          title="Loan could not be loaded"
          message={toUserMessage(loan.error)}
          onRetry={() => void loan.refetch()}
        />
      </div>
    );
  }

  if (!loan.data) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState title="Loan not found" description="No record to show." />
      </div>
    );
  }

  return <LoanDetail loan={loan.data} />;
}

function LoanDetail({ loan }: { loan: LoanDetailDto }) {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const businessDate = getLagosBusinessDate();

  const outstanding = BigInt(loan.outstandingKobo);
  const isSettled = outstanding <= 0n;

  const statusLabel = isSettled
    ? "Paid"
    : loan.dueDate !== null && loan.dueDate < businessDate
      ? "Overdue"
      : "Active";
  const statusTone = isSettled
    ? ("success" as const)
    : loan.dueDate !== null && loan.dueDate < businessDate
      ? ("danger" as const)
      : ("info" as const);

  const [repayAmount, setRepayAmount] = useState("");
  const [repayInterest, setRepayInterest] = useState("0");
  const [repayDate, setRepayDate] = useState(() => getLagosBusinessDate());
  const [repayNote, setRepayNote] = useState("");
  const [repayError, setRepayError] = useState("");

  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeReason, setChargeReason] = useState("");
  const [chargeDate, setChargeDate] = useState(() => getLagosBusinessDate());
  const [chargeError, setChargeError] = useState("");

  const repaySubmitting = useRef(false);
  const chargeSubmitting = useRef(false);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.loans.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
  }

  const repayMutation = useMutation({
    mutationFn: (input: {
      amountKobo: string;
      interestPortionKobo: string;
      paidAt: string;
      note: string | null;
    }) => loansApi.recordRepayment(loan.id, input),
    onSuccess: () => {
      invalidate();
      setRepayAmount("");
      setRepayInterest("0");
      setRepayNote("");
      setRepayError("");
    },
  });

  const chargeMutation = useMutation({
    mutationFn: (input: {
      amountKobo: string;
      reason: string;
      occurredAt: string;
    }) => loansApi.addCharge(loan.id, input),
    onSuccess: () => {
      invalidate();
      setChargeAmount("");
      setChargeReason("");
      setChargeError("");
    },
  });

  async function submitRepayment(event: React.FormEvent) {
    event.preventDefault();
    if (repaySubmitting.current || repayMutation.isPending) return;
    repayMutation.reset();
    setRepayError("");

    if (repayAmount.trim() === "" || !/^[0-9]+$/.test(repayAmount)) {
      setRepayError("Enter a valid repayment amount.");
      return;
    }
    const amount = BigInt(repayAmount);
    if (amount <= 0n) {
      setRepayError("Enter an amount greater than zero.");
      return;
    }
    if (amount > outstanding) {
      setRepayError(
        `The repayment cannot be more than the outstanding balance of ${formatNaira(outstanding)}.`,
      );
      return;
    }
    const interestPortion =
      repayInterest.trim() === "" ? 0n : BigInt(repayInterest);
    if (interestPortion < 0n || interestPortion > amount) {
      setRepayError(
        "The interest portion must be between zero and the repayment amount.",
      );
      return;
    }
    if (repayDate === "") {
      setRepayError("Choose the date the repayment was made.");
      return;
    }
    if (repayDate > businessDate) {
      setRepayError("The repayment date cannot be in the future.");
      return;
    }

    const principalPortion = amount - interestPortion;
    const remaining = outstanding - amount;
    const clears = remaining === 0n;

    repaySubmitting.current = true;
    try {
      await confirm({
        title: "Record this repayment?",
        description: "Confirm before the repayment is saved.",
        confirmLabel: "Record repayment",
        successMessage: `Repayment of ${formatNaira(amount)} recorded for ${loan.lenderName}.`,
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Lender">{loan.lenderName}</SummaryRow>
            <SummaryRow label="Amount">
              <Money kobo={amount} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Interest portion">
              <Money kobo={interestPortion} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Principal portion">
              <Money kobo={principalPortion} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Outstanding after">
              {remaining > 0n ? (
                <Money kobo={remaining} />
              ) : (
                <span className="text-success">Settled</span>
              )}
            </SummaryRow>
            {interestPortion > 0n && (
              <p className="rounded-sm border border-info/30 bg-info-surface px-2 py-1 text-xs text-info">
                An expense of {formatNaira(interestPortion)} will be recorded
                for the interest, reducing net profit.
              </p>
            )}
            {clears && (
              <p className="rounded-sm border border-success/30 bg-success-surface px-2 py-1 text-xs text-success">
                This will clear the loan.
              </p>
            )}
          </dl>
        ),
        onConfirm: () =>
          repayMutation.mutateAsync({
            amountKobo: repayAmount,
            interestPortionKobo: interestPortion.toString(),
            paidAt: createLagosDateTime(repayDate).toISOString(),
            note: repayNote.trim() === "" ? null : repayNote.trim(),
          }),
      });
    } finally {
      repaySubmitting.current = false;
    }
  }

  async function submitCharge(event: React.FormEvent) {
    event.preventDefault();
    if (chargeSubmitting.current || chargeMutation.isPending) return;
    chargeMutation.reset();
    setChargeError("");

    if (chargeAmount.trim() === "" || !/^[0-9]+$/.test(chargeAmount)) {
      setChargeError("Enter a valid charge amount.");
      return;
    }
    const amount = BigInt(chargeAmount);
    if (amount <= 0n) {
      setChargeError("Enter an amount greater than zero.");
      return;
    }
    if (chargeReason.trim() === "") {
      setChargeError("Enter a reason for the charge.");
      return;
    }
    if (chargeDate === "" || chargeDate > businessDate) {
      setChargeError("Choose a valid date (not in the future).");
      return;
    }

    chargeSubmitting.current = true;
    try {
      await confirm({
        title: "Add this charge?",
        description: "Extra fees or penalties increase what you owe.",
        confirmLabel: "Add charge",
        successMessage: `Charge of ${formatNaira(amount)} added to the ${loan.lenderName} loan.`,
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Lender">{loan.lenderName}</SummaryRow>
            <SummaryRow label="Amount">
              <Money kobo={amount} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Reason">{chargeReason.trim()}</SummaryRow>
            <SummaryRow label="Outstanding after">
              <Money kobo={outstanding + amount} />
            </SummaryRow>
          </dl>
        ),
        onConfirm: () =>
          chargeMutation.mutateAsync({
            amountKobo: chargeAmount,
            reason: chargeReason.trim(),
            occurredAt: createLagosDateTime(chargeDate).toISOString(),
          }),
      });
    } finally {
      chargeSubmitting.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={loan.lenderName}
        description={`Loan recorded ${formatLagosDate(loan.disbursedAt)}.`}
        actions={
          <Link
            href="/accounting/loans"
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to loans
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Summary"
          action={<Badge tone={statusTone}>{statusLabel}</Badge>}
        />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Principal</dt>
              <dd className="text-lg font-semibold text-foreground">
                <Money kobo={loan.principalKobo} tone="neutral" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Agreed interest</dt>
              <dd className="text-lg font-semibold text-foreground">
                <Money kobo={loan.agreedInterestKobo} tone="neutral" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Outstanding</dt>
              <dd
                className={`text-lg font-semibold ${
                  isSettled ? "text-success" : "text-danger"
                }`}
              >
                <Money kobo={outstanding > 0n ? outstanding : 0n} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Due date</dt>
              <dd className="text-sm text-foreground">
                {loan.dueDate === null
                  ? "No due date"
                  : formatLagosDate(loan.dueDate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Received</dt>
              <dd className="text-sm text-foreground">
                {formatLagosDate(loan.disbursedAt)}
              </dd>
            </div>
            {loan.note && (
              <div className="sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Note</dt>
                <dd className="text-sm text-foreground">{loan.note}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Ledger" description="Every movement on this loan." />
        <CardBody>
          {loan.ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entries yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {loan.ledger.map((entry) => {
                const amount = BigInt(entry.amountKobo);
                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {LEDGER_LABEL[entry.type] ?? entry.type}
                        {entry.reversesEntryId !== null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (reversal)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatLagosDateTime(entry.occurredAt)}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </p>
                    </div>
                    <Money kobo={amount} className="font-medium" />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Record repayment"
            description="Reduces what you owe. Interest also becomes an expense."
          />
          <CardBody>
            <form onSubmit={submitRepayment} className="space-y-4" noValidate>
              <MoneyInput
                key={`repay-${outstanding.toString()}`}
                id="repay-amount"
                label="Amount"
                defaultValueKobo={isSettled ? "0" : outstanding.toString()}
                onKoboChange={setRepayAmount}
              />
              <MoneyInput
                id="repay-interest"
                label="Interest portion (0 if none)"
                defaultValueKobo="0"
                onKoboChange={setRepayInterest}
              />
              <FormField id="repay-date" label="Date paid">
                <Input
                  id="repay-date"
                  type="date"
                  value={repayDate}
                  max={businessDate}
                  onChange={(event) => setRepayDate(event.target.value)}
                />
              </FormField>
              <FormField id="repay-note" label="Note (optional)">
                <Textarea
                  id="repay-note"
                  value={repayNote}
                  rows={2}
                  onChange={(event) => setRepayNote(event.target.value)}
                />
              </FormField>

              {repayError && (
                <p role="alert" className="text-sm text-danger">
                  {repayError}
                </p>
              )}
              {repayMutation.isError && (
                <p role="alert" className="text-sm text-danger">
                  {toUserMessage(repayMutation.error)}
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
                className="w-full"
                loading={repayMutation.isPending}
                disabled={network.offline || isSettled}
              >
                <Landmark aria-hidden="true" className="h-4 w-4" />
                Record repayment
              </Button>
              {isSettled && (
                <p className="text-sm text-muted-foreground">
                  This loan is fully settled.
                </p>
              )}
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Add charge"
            description="Extra fees or penalties agreed after the fact."
          />
          <CardBody>
            <form onSubmit={submitCharge} className="space-y-4" noValidate>
              <MoneyInput
                id="charge-amount"
                label="Amount"
                defaultValueKobo="0"
                onKoboChange={setChargeAmount}
              />
              <FormField id="charge-reason" label="Reason">
                <Input
                  id="charge-reason"
                  value={chargeReason}
                  onChange={(event) => setChargeReason(event.target.value)}
                  placeholder="e.g. Late payment penalty"
                />
              </FormField>
              <FormField id="charge-date" label="Date">
                <Input
                  id="charge-date"
                  type="date"
                  value={chargeDate}
                  max={businessDate}
                  onChange={(event) => setChargeDate(event.target.value)}
                />
              </FormField>

              {chargeError && (
                <p role="alert" className="text-sm text-danger">
                  {chargeError}
                </p>
              )}
              {chargeMutation.isError && (
                <p role="alert" className="text-sm text-danger">
                  {toUserMessage(chargeMutation.error)}
                </p>
              )}

              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                loading={chargeMutation.isPending}
                disabled={network.offline}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add charge
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Repayment history" />
        <CardBody>
          {loan.repayments.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Receipt aria-hidden="true" className="h-4 w-4" />
              No repayments recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {loan.repayments.map((repayment) => (
                <li
                  key={repayment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      {formatLagosDateTime(repayment.paidAt)}
                    </p>
                    {repayment.note && (
                      <p className="text-xs text-muted-foreground">
                        {repayment.note}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <Money
                      kobo={repayment.amountKobo}
                      className="font-medium"
                    />
                    {BigInt(repayment.interestPortionKobo) > 0n && (
                      <p className="text-xs text-muted-foreground">
                        incl. interest{" "}
                        <Money
                          kobo={repayment.interestPortionKobo}
                          tone="neutral"
                        />
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
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
