"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, Ban } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDate,
  getLagosBusinessDate,
  type ExpenseCategory,
  type ExpenseDto,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { expensesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  UTILITY: "Utility",
  SALARY: "Salary",
  TRANSPORT: "Transport",
  MAINTENANCE: "Maintenance",
  SUPPLIES: "Supplies",
  MARKETING: "Marketing",
  LOAN_INTEREST: "Loan interest",
  OTHER: "Other",
};

const CHANNEL_LABELS = {
  RETAIL: "Retail (Fridge)",
  WHOLESALE: "Wholesale",
  BOTH: "Both",
} as const;

export default function ExpensesPage() {
  const queryClient = useQueryClient();

  const [filterDate, setFilterDate] = useState("");
  const [voidTarget, setVoidTarget] = useState<ExpenseDto | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const businessDate = useLagosBusinessDate();

  const expenses = useQuery({
    queryKey: queryKeys.expenses.list(),
    queryFn: () => expensesApi.list(),
  });

  const voidMutation = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      expensesApi.void(input.id, input.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      setVoidTarget(null);
      setVoidReason("");
      setVoidError("");
    },
  });

  const rows = useMemo(() => {
    return (expenses.data ?? [])
      .filter(
        (expense) =>
          filterDate === "" ||
          getLagosBusinessDate(new Date(expense.expenseDate)) === filterDate,
      )
      .sort(
        (a, b) =>
          new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime(),
      );
  }, [expenses.data, filterDate]);

  const totalKobo = rows.reduce(
    (sum, expense) =>
      expense.voidedAt === null ? sum + BigInt(expense.amountKobo) : sum,
    0n,
  );

  function requestVoid(expense: ExpenseDto) {
    setVoidTarget(expense);
    setVoidReason("");
    setVoidError("");
    voidMutation.reset();
  }

  function submitVoid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voidTarget) return;
    if (voidReason.trim() === "") {
      setVoidError("Enter a reason for voiding this expense.");
      return;
    }
    voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() });
  }

  const columns: ResponsiveTableColumn<ExpenseDto>[] = [
    {
      header: "Date",
      render: (e) => formatLagosDate(e.expenseDate),
    },
    {
      header: "Channel",
      render: (e) => CHANNEL_LABELS[e.channel],
    },
    {
      header: "Category",
      render: (e) => CATEGORY_LABELS[e.category],
    },
    {
      header: "Description",
      render: (e) => e.description,
    },
    {
      header: "Amount",
      align: "right",
      render: (e) => <Money kobo={e.amountKobo} tone="neutral" />,
    },
    {
      header: "Status",
      render: (expense) =>
        expense.voidedAt === null ? "Active" : `Voided: ${expense.voidReason}`,
    },
    {
      header: "Actions",
      align: "right",
      render: (e) =>
        e.voidedAt !== null ? (
          <span className="text-xs text-muted-foreground">Voided</span>
        ) : e.loanRepaymentId !== null ? (
          <span className="text-xs text-muted-foreground">
            Managed with loan repayment
          </span>
        ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger/10"
          onClick={() => requestVoid(e)}
        >
          <Ban aria-hidden="true" className="h-4 w-4" />
          Void
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track operating costs by channel."
        actions={
          <Link href="/expenses/new" className={buttonClasses()}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add expense
          </Link>
        }
      />

      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title="Void expense"
        description="This keeps the expense in the audit trail and reverses its account movement."
        busy={voidMutation.isPending}
      >
        {voidTarget && (
          <form onSubmit={submitVoid} className="space-y-4" noValidate>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{voidTarget.description}</span>
              <Money kobo={voidTarget.amountKobo} tone="neutral" />
            </div>
            <FormField id="void-reason" label="Reason">
              <Textarea
                id="void-reason"
                value={voidReason}
                rows={3}
                onChange={(event) => setVoidReason(event.target.value)}
              />
            </FormField>
            {voidError && (
              <p role="alert" className="text-sm text-danger">
                {voidError}
              </p>
            )}
            {voidMutation.isError && (
              <p role="alert" className="text-sm text-danger">
                {toUserMessage(voidMutation.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={voidMutation.isPending}
                onClick={() => setVoidTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={voidMutation.isPending}>
                Void expense
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <StatCard
        label={
          filterDate === "" ? "Total expenses" : "Expenses on selected date"
        }
        value={<Money kobo={totalKobo} tone="neutral" />}
        icon={Receipt}
      />

      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter
            id="f-date"
            value={filterDate}
            onChange={setFilterDate}
            max={businessDate}
          />
        </CardBody>
      </Card>

      {expenses.isPending ? (
        <Skeleton variant="row" count={5} />
      ) : expenses.isError ? (
        <ErrorState
          title="Expenses could not be loaded"
          message={toUserMessage(expenses.error)}
          onRetry={() => void expenses.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses yet"
          description="Add your first expense to start tracking costs."
          action={
            <Link
              href="/expenses/new"
              className={buttonClasses({ variant: "secondary" })}
            >
              Add expense
            </Link>
          }
        />
      ) : (
        <ResponsiveTable rows={rows} columns={columns} getKey={(e) => e.id} />
      )}
    </div>
  );
}
