"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDate,
  formatNaira,
  getLagosBusinessDate,
  type ExpenseCategory,
  type ExpenseDto,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { expensesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  UTILITY: "Utility",
  SALARY: "Salary",
  TRANSPORT: "Transport",
  MAINTENANCE: "Maintenance",
  SUPPLIES: "Supplies",
  MARKETING: "Marketing",
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all }),
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
      render: (e) => formatNaira(e.amountKobo),
    },
    {
      header: "Actions",
      render: (e) => (
        <button
          type="button"
          onClick={() => {
            if (confirm("Delete this expense?")) {
              deleteMutation.mutate(e.id);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      ),
    },
  ];

  const totalKobo = rows.reduce((sum, e) => sum + BigInt(e.amountKobo), 0n);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Track operating costs by channel
          </p>
        </div>
        <Link
          href="/expenses/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Expense
        </Link>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground">
          {filterDate === "" ? "Total Expenses" : "Expenses on selected date"}
        </div>
        <div className="text-2xl font-bold">{formatNaira(totalKobo)}</div>
      </div>

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <DateFilter
          id="f-date"
          value={filterDate}
          onChange={setFilterDate}
          max={businessDate}
        />
      </div>

      {expenses.isLoading ? (
        <ListLoading />
      ) : expenses.isError ? (
        <ListError
          message="Could not load expenses."
          retry={() => void expenses.refetch()}
        />
      ) : rows.length > 0 ? (
        <ResponsiveTable columns={columns} rows={rows} getKey={(e) => e.id} />
      ) : (
        <ListEmpty message="Add your first expense to start tracking costs." />
      )}
    </div>
  );
}
