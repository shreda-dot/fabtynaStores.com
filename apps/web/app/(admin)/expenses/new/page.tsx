"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createLagosDateTime,
  formatNaira,
  getLagosBusinessDate,
  type CreateExpenseDto,
  type ExpenseCategory,
  type SaleChannel,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { expensesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/stores/toast-store";

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

const AMOUNT_ID = "expense-amount";
const DESCRIPTION_ID = "expense-description";
const DATE_ID = "expense-date";

function validateAmount(value: string): string {
  if (value.trim() === "") return "Enter an amount.";
  if (!/^[0-9]+$/.test(value) || BigInt(value) <= 0n)
    return "Amount must be greater than zero.";
  return "";
}

function validateDescription(value: string): string {
  if (value.trim() === "") return "Enter a description.";
  return "";
}

function validateDate(value: string): string {
  if (value === "") return "Choose a date.";
  if (value > getLagosBusinessDate()) return "The date cannot be in the future.";
  return "";
}

export default function NewExpensePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const network = useNetworkStatus();

  const [channel, setChannel] = useState<SaleChannel>("RETAIL");
  const [category, setCategory] = useState<ExpenseCategory>("OTHER");
  const [description, setDescription] = useState("");
  const [amountKobo, setAmountKobo] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => getLagosBusinessDate());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submitting = useRef(false);

  const createMutation = useMutation({
    mutationFn: (input: CreateExpenseDto) => expensesApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      toast.success(`Expense of ${formatNaira(amountKobo)} recorded.`);
      router.push("/expenses");
    },
    onError: (error) => {
      toast.error(toUserMessage(error));
    },
  });

  function setFieldError(key: string, message: string) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message === "") delete next[key];
      else next[key] = message;
      return next;
    });
  }

  function validateAll(): Record<string, string> {
    const found: Record<string, string> = {};
    const descriptionError = validateDescription(description);
    if (descriptionError !== "") found[DESCRIPTION_ID] = descriptionError;
    const amountError = validateAmount(amountKobo);
    if (amountError !== "") found[AMOUNT_ID] = amountError;
    const dateError = validateDate(expenseDate);
    if (dateError !== "") found[DATE_ID] = dateError;
    return found;
  }

  function focusFirstError(found: Record<string, string>) {
    const order = [DESCRIPTION_ID, AMOUNT_ID, DATE_ID];
    const firstId = order.find((id) => found[id] !== undefined);
    if (!firstId) return;
    const element = document.getElementById(firstId);
    if (element instanceof HTMLElement) element.focus();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || createMutation.isPending) return;
    if (network.offline) return;
    createMutation.reset();

    const found = validateAll();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }

    const input: CreateExpenseDto = {
      channel,
      category,
      description: description.trim(),
      amountKobo,
      expenseDate: createLagosDateTime(expenseDate).toISOString(),
    };

    submitting.current = true;
    try {
      await createMutation.mutateAsync(input);
    } catch {
      // The mutation's `onError` surfaces the message (inline + toast).
    } finally {
      submitting.current = false;
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New expense"
        description="Record an operating cost and assign it to a channel."
        actions={
          <Link
            href="/expenses"
            className={buttonClasses({ variant: "secondary" })}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to expenses
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
              {Object.entries(errors).map(([key, message]) => (
                <li key={key}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <Card>
          <CardHeader
            title="Expense details"
            description="Channel, category and purpose of the cost."
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="expense-channel" label="Channel">
                <Select
                  id="expense-channel"
                  value={channel}
                  onChange={(event) =>
                    setChannel(event.target.value as SaleChannel)
                  }
                >
                  {CHANNELS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField id="expense-category" label="Category">
                <Select
                  id="expense-category"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as ExpenseCategory)
                  }
                >
                  {CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <FormField
              id={DESCRIPTION_ID}
              label="Description / Purpose"
              error={errors[DESCRIPTION_ID]}
            >
              <Textarea
                id={DESCRIPTION_ID}
                value={description}
                rows={2}
                aria-invalid={errors[DESCRIPTION_ID] !== undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setDescription(value);
                  if (errors[DESCRIPTION_ID] !== undefined)
                    setFieldError(DESCRIPTION_ID, validateDescription(value));
                }}
                onBlur={() =>
                  setFieldError(
                    DESCRIPTION_ID,
                    validateDescription(description),
                  )
                }
                placeholder="e.g. Monthly fridge fuel for January"
              />
            </FormField>

            <div className="space-y-1.5">
              <MoneyInput
                id={AMOUNT_ID}
                label="Amount"
                defaultValueKobo="0"
                onKoboChange={(value) => {
                  setAmountKobo(value);
                  if (
                    errors[AMOUNT_ID] !== undefined &&
                    validateAmount(value) === ""
                  ) {
                    setFieldError(AMOUNT_ID, "");
                  }
                }}
              />
              {errors[AMOUNT_ID] && (
                <p role="alert" className="text-sm text-danger">
                  {errors[AMOUNT_ID]}
                </p>
              )}
            </div>

            <FormField id={DATE_ID} label="Date" error={errors[DATE_ID]}>
              <Input
                id={DATE_ID}
                type="date"
                value={expenseDate}
                max={getLagosBusinessDate()}
                aria-invalid={errors[DATE_ID] !== undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setExpenseDate(value);
                  if (errors[DATE_ID] !== undefined)
                    setFieldError(DATE_ID, validateDate(value));
                }}
                onBlur={() =>
                  setFieldError(DATE_ID, validateDate(expenseDate))
                }
              />
            </FormField>

            {createMutation.isError && (
              <p role="alert" className="text-sm text-danger">
                {toUserMessage(createMutation.error)}
              </p>
            )}
            {network.offline && (
              <p className="text-sm text-warning">
                You&rsquo;re offline. Changes can&rsquo;t be saved until you
                reconnect.
              </p>
            )}
          </CardBody>
          <CardFooter>
            <Link
              href="/expenses"
              className={buttonClasses({ variant: "secondary" })}
            >
              Cancel
            </Link>
            <Button
              type="submit"
              size="lg"
              loading={createMutation.isPending}
              disabled={network.offline}
            >
              Save expense
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
