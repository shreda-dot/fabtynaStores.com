"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDate,
  formatNaira,
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
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { expensesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";

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
  const businessDate = useLagosBusinessDate();

  const expenses = useQuery({
    queryKey: queryKeys.expenses.list(),
    queryFn: () => expensesApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
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

  const totalKobo = rows.reduce((sum, e) => sum + BigInt(e.amountKobo), 0n);

  function askDelete(expense: ExpenseDto) {
    void confirm({
      tone: "danger",
      title: "Delete this expense?",
      description: expense.description,
      details: (
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-medium text-foreground">
              <Money kobo={expense.amountKobo} tone="neutral" />
            </dd>
          </div>
        </dl>
      ),
      confirmLabel: "Delete expense",
      successMessage: `Expense of ${formatNaira(expense.amountKobo)} deleted.`,
      onConfirm: () => deleteMutation.mutateAsync(expense.id),
    });
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
      header: "Actions",
      align: "right",
      render: (e) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger/10"
          onClick={() => askDelete(e)}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Delete
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
