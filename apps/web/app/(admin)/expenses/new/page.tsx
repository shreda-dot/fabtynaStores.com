"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  getLagosBusinessDate,
  type CreateExpenseDto,
  type ExpenseCategory,
  type SaleChannel,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { expensesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const CHANNELS: { value: SaleChannel; label: string }[] = [
  { value: "RETAIL", label: "Retail (Fridge)" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "BOTH", label: "Both (split equally)" },
];

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "RENT", label: "Rent" },
  { value: "UTILITY", label: "Utility" },
  { value: "SALARY", label: "Salary" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "SUPPLIES", label: "Supplies" },
  { value: "MARKETING", label: "Marketing" },
  { value: "OTHER", label: "Other" },
];

export default function NewExpensePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [channel, setChannel] = useState<SaleChannel>("RETAIL");
  const [category, setCategory] = useState<ExpenseCategory>("OTHER");
  const [description, setDescription] = useState("");
  const [amountKobo, setAmountKobo] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => getLagosBusinessDate());
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: (input: CreateExpenseDto) => expensesApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      router.push("/expenses");
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!amountKobo) {
      setError("Enter an amount.");
      return;
    }
    if (!description.trim()) {
      setError("Enter a description.");
      return;
    }
    const dateIso = createLagosDateTime(expenseDate).toISOString();
    createMutation.mutate({
      channel,
      category,
      description: description.trim(),
      amountKobo,
      expenseDate: dateIso,
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/expenses"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Expenses
      </Link>

      <div>
        <h1 className="text-2xl font-bold">New Expense</h1>
        <p className="text-sm text-muted-foreground">
          Record an operating cost and assign it to a channel
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Channel</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setChannel(c.value)}
                className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                  channel === c.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="category" className="block text-sm font-medium">
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="description" className="block text-sm font-medium">
            Description / Purpose
          </label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Monthly fridge fuel for January"
            className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <MoneyInput
          id="amount"
          label="Amount"
          defaultValueKobo="0"
          onKoboChange={setAmountKobo}
        />

        <div className="space-y-1.5">
          <label htmlFor="expenseDate" className="block text-sm font-medium">
            Date
          </label>
          <input
            id="expenseDate"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {createMutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : "Failed to save expense."}
          </p>
        )}

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {createMutation.isPending ? "Saving..." : "Save Expense"}
        </button>
      </form>
    </div>
  );
}
