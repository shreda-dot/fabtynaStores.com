"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  formatNaira,
  getLagosBusinessDate,
  type CreateLoanDto,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { accountingApi, loansApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

export default function NewLoanPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [lenderName, setLenderName] = useState("");
  const [principalKobo, setPrincipalKobo] = useState("");
  const [interestKobo, setInterestKobo] = useState("0");
  const [disbursedAt, setDisbursedAt] = useState<string>(() =>
    getLagosBusinessDate(),
  );
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submitting = useRef(false);
  const network = useNetworkStatus();
  const businessDate = useLagosBusinessDate();
  const accountsQuery = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });

  const principal = /^[0-9]+$/.test(principalKobo)
    ? BigInt(principalKobo)
    : -1n;
  const interest = /^[0-9]+$/.test(interestKobo) ? BigInt(interestKobo) : -1n;
  const totalToRepay =
    principal > 0n && interest >= 0n ? principal + interest : 0n;

  const createMutation = useMutation({
    mutationFn: (input: CreateLoanDto) => loansApi.create(input),
    onSuccess: (loan) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.loans.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.all,
      });
      toast.success(
        `${loan.lenderName} loan recorded — ${formatNaira(principal)} borrowed.`,
      );
      router.push(`/accounting/loans/${loan.id}`);
    },
  });

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (lenderName.trim() === "") {
      found["loan-lender"] = "Enter who you borrowed from.";
    }
    if (principalKobo.trim() === "" || principal <= 0n) {
      found["loan-principal"] =
        "Enter the amount borrowed (greater than zero).";
    }
    if (defaultAccountId(accountsQuery.data ?? []) === "") {
      found["loan-account"] = "Add an active account before recording the funds received.";
    }
    if (interestKobo.trim() === "" || interest < 0n) {
      found["loan-interest"] = "Enter the agreed interest (0 is allowed).";
    }
    if (disbursedAt === "") {
      found["loan-disbursed"] = "Choose the date you received the money.";
    } else if (disbursedAt > businessDate) {
      found["loan-disbursed"] = "The date cannot be in the future.";
    }
    if (dueDate !== "" && disbursedAt !== "" && dueDate < disbursedAt) {
      found["loan-due"] =
        "The due date cannot be before the disbursement date.";
    }
    return found;
  }

  function focusFirstError(found: Record<string, string>) {
    const order = [
      "loan-lender",
      "loan-principal",
      "loan-account",
      "loan-interest",
      "loan-disbursed",
      "loan-due",
    ];
    const firstId = order.find((key) => found[key] !== undefined);
    if (!firstId) return;
    const element = document.getElementById(firstId);
    if (element instanceof HTMLElement) element.focus();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || createMutation.isPending) return;
    createMutation.reset();

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      toast.warning("Please fix the highlighted fields.");
      return;
    }

    const input: CreateLoanDto = {
      lenderName: lenderName.trim(),
      principalKobo: principal.toString(),
      agreedInterestKobo: interest.toString(),
      disbursedAt: createLagosDateTime(disbursedAt).toISOString(),
      dueDate: dueDate === "" ? null : dueDate,
      note: note.trim() === "" ? null : note.trim(),
      accountId: accountId || defaultAccountId(accountsQuery.data ?? []),
    };

    submitting.current = true;
    try {
      await confirm({
        title: "Record this loan?",
        description: "Confirm the details before the loan is saved.",
        confirmLabel: "Record loan",
        details: (
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Lender">{lenderName.trim()}</SummaryRow>
            <SummaryRow label="Principal">
              <Money kobo={principal} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Agreed interest">
              <Money kobo={interest < 0n ? 0n : interest} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Total to repay">
              <Money kobo={totalToRepay} tone="neutral" />
            </SummaryRow>
            <SummaryRow label="Received">{disbursedAt}</SummaryRow>
            <SummaryRow label="Due date">
              {dueDate === "" ? "No due date" : dueDate}
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
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New loan"
        description="Record money you have borrowed."
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
          <CardHeader title="Loan details" />
          <CardBody className="space-y-4">
            <FormField
              id="loan-lender"
              label="Lender"
              error={errors["loan-lender"]}
            >
              <Input
                id="loan-lender"
                value={lenderName}
                aria-invalid={errors["loan-lender"] !== undefined}
                onChange={(event) => setLenderName(event.target.value)}
                placeholder="e.g. First Bank"
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <MoneyInput
                  id="loan-principal"
                  label="Amount borrowed"
                  defaultValueKobo="0"
                  onKoboChange={setPrincipalKobo}
                />
                {errors["loan-principal"] && (
                  <p role="alert" className="text-sm text-danger">
                    {errors["loan-principal"]}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <MoneyInput
                  id="loan-interest"
                  label="Agreed interest / fees"
                  defaultValueKobo="0"
                  onKoboChange={setInterestKobo}
                />
                {errors["loan-interest"] && (
                  <p role="alert" className="text-sm text-danger">
                    {errors["loan-interest"]}
                  </p>
                )}
              </div>

              <FormField
                id="loan-disbursed"
                label="Date received"
                error={errors["loan-disbursed"]}
              >
                <Input
                  id="loan-disbursed"
                  type="date"
                  value={disbursedAt}
                  max={businessDate}
                  aria-invalid={errors["loan-disbursed"] !== undefined}
                  onChange={(event) => setDisbursedAt(event.target.value)}
                />
              </FormField>

              <AccountSelect
                id="loan-account"
                label="Received into"
                accounts={accountsQuery.data ?? []}
                accountId={accountId}
                onChange={setAccountId}
                disabled={accountsQuery.isPending || accountsQuery.isError}
              />

              <FormField
                id="loan-due"
                label="Due date (optional)"
                error={errors["loan-due"]}
              >
                <Input
                  id="loan-due"
                  type="date"
                  value={dueDate}
                  min={disbursedAt}
                  aria-invalid={errors["loan-due"] !== undefined}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </FormField>
            </div>

            <FormField id="loan-note" label="Note (optional)">
              <Textarea
                id="loan-note"
                value={note}
                rows={2}
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Principal</dt>
                <dd className="text-lg font-semibold text-foreground">
                  <Money
                    kobo={principal < 0n ? 0n : principal}
                    tone="neutral"
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Interest</dt>
                <dd className="text-lg font-semibold text-foreground">
                  <Money kobo={interest < 0n ? 0n : interest} tone="neutral" />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Total to repay
                </dt>
                <dd className="text-lg font-semibold text-foreground">
                  <Money kobo={totalToRepay} tone="neutral" />
                </dd>
              </div>
            </dl>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {createMutation.isError && (
                <p role="alert" className="text-sm text-danger sm:mr-auto">
                  {toUserMessage(createMutation.error)}
                </p>
              )}
              {accountsQuery.isError && (
                <p role="alert" className="text-sm text-danger">
                  Accounts could not be loaded: {toUserMessage(accountsQuery.error)}
                </p>
              )}
              {network.offline && (
                <p className="text-sm text-warning sm:mr-auto">
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
                Record loan
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
