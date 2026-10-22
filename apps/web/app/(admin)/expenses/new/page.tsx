"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import {
  createLagosDateTime,
  formatNaira,
  getLagosBusinessDate,
  type SaleChannel,
} from "@fabtyna/shared";
import type {
  CreateExpenseInput,
  ExpenseAmendResultDto,
  ExpenseCategoryDto,
  ExpenseRecordDto,
} from "@/lib/api/expenses.api";
import { MoneyInput } from "@/components/money-input";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { accountingApi, expensesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { selectableCategories } from "@/lib/expense-filters";
import { toast } from "@/stores/toast-store";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { WriteFlowStatus } from "@/components/write-flow-status";

const CHANNELS: { value: SaleChannel; label: string }[] = [
  { value: "RETAIL", label: "Retail (Fridge)" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "BOTH", label: "Both (split equally)" },
];

const CATEGORIES: { value: string; label: string }[] = [
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
  const searchParams = useSearchParams();
  const amendId = searchParams.get("amendId");
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const writeFlow = useWriteFlow();
  const [lastInput, setLastInput] = useState<CreateExpenseInput | null>(null);
  const accountsQuery = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.expenses.categories(false),
    queryFn: async () =>
      (await expensesApi.listCategories?.()) ??
      CATEGORIES.map((category): ExpenseCategoryDto => ({
        id: category.value,
        name: category.label,
        code: category.value,
        isActive: true,
        createdAt: "",
        expenseCount: 0,
      })),
  });
  const [categorySearch, setCategorySearch] = useState("");
  const allSelectable = selectableCategories(categoriesQuery.data ?? []);
  const [channel, setChannel] = useState<SaleChannel>(() =>
    searchParams.get("channel") === "WHOLESALE" || searchParams.get("channel") === "BOTH"
      ? searchParams.get("channel") as SaleChannel
      : "RETAIL",
  );
  const [category, setCategory] = useState(() => searchParams.get("categoryId") ?? "");
  const [description, setDescription] = useState(() => searchParams.get("description") ?? "");
  const [amountKobo, setAmountKobo] = useState(() => searchParams.get("amountKobo") ?? "");
  const [expenseDate, setExpenseDate] = useState(() => {
    const prefill = searchParams.get("expenseDate");
    return prefill !== null && /^\d{4}-\d{2}-\d{2}$/.test(prefill)
      ? prefill
      : getLagosBusinessDate();
  });
  const [accountId, setAccountId] = useState(() => searchParams.get("accountId") ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const searchNeedle = categorySearch.trim().toLowerCase();
  // The chosen category stays listed even when the search would hide it.
  const availableCategories = allSelectable.filter(
    (row) =>
      searchNeedle === "" ||
      row.name.toLowerCase().includes(searchNeedle) ||
      row.id === category,
  );
  const selectedCategoryId =
    category ||
    allSelectable.find((row) => row.code === "OTHER")?.id ||
    allSelectable[0]?.id ||
    "";

  const submitting = useRef(false);

  const createMutation = useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      setLastInput(input);
      if (isMockApiMode) {
        return amendId
          ? expensesApi.amend(amendId, input)
          : expensesApi.create(input);
      }
      return writeFlow.run((key): Promise<ExpenseRecordDto | ExpenseAmendResultDto> =>
        amendId
          ? expensesApi.amend(amendId, input, key)
          : expensesApi.create(input, key),
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      toast.success(
        amendId && "voidedExpenseId" in result
          ? `Expense amended; original ${result.voidedExpenseId} was voided.`
          : `Expense of ${formatNaira(amountKobo)} recorded.`,
      );
      router.push("/expenses");
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
    if (selectedCategoryId === "") found["expense-category"] = "Choose an active category.";
    if (defaultAccountId(accountsQuery.data ?? []) === "") {
      found["expense-account"] =
        "Add an active account before recording this expense.";
    }
    return found;
  }

  function focusFirstError(found: Record<string, string>) {
    const order = [DESCRIPTION_ID, AMOUNT_ID, "expense-account", DATE_ID];
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

    const input: CreateExpenseInput = {
      channel,
      categoryId: selectedCategoryId,
      description: description.trim(),
      amountKobo,
      expenseDate: createLagosDateTime(expenseDate).toISOString(),
      accountId: accountId || defaultAccountId(accountsQuery.data ?? []),
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
        title={amendId ? "Amend expense" : "New expense"}
        description={amendId
          ? "Amending voids the original expense and creates a new immutable record."
          : "Record an operating cost and assign it to a channel."}
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
                  onChange={(event) => {
                    writeFlow.edit();
                    setChannel(event.target.value as SaleChannel);
                  }}
                >
                  {CHANNELS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField id="expense-category" label="Category">
                {allSelectable.length > 8 && (
                  <Input
                    aria-label="Search categories"
                    placeholder="Search categories"
                    value={categorySearch}
                    onChange={(event) => setCategorySearch(event.target.value)}
                  />
                )}
                <Select
                  id="expense-category"
                  value={selectedCategoryId}
                  onChange={(event) => {
                    writeFlow.edit();
                    setCategory(event.target.value);
                  }}
                >
                  <option value="">Choose category</option>
                  {availableCategories.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <AccountSelect
              id="expense-account"
              label="Paid from"
              accounts={accountsQuery.data ?? []}
              accountId={accountId}
              onChange={(value) => {
                writeFlow.edit();
                setAccountId(value);
              }}
              disabled={accountsQuery.isPending || accountsQuery.isError}
            />
            {errors["expense-account"] && (
              <p role="alert" className="text-sm text-danger">
                {errors["expense-account"]}
              </p>
            )}
            {accountsQuery.isError && (
              <p role="alert" className="text-sm text-danger">
                Accounts could not be loaded: {toUserMessage(accountsQuery.error)}
              </p>
            )}
            {categoriesQuery.isError && (
              <p role="alert" className="text-sm text-danger">
                Expense categories could not be loaded: {toUserMessage(categoriesQuery.error)}
              </p>
            )}

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
                  writeFlow.edit();
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
                  writeFlow.edit();
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
              {channel === "BOTH" && /^[0-9]+$/.test(amountKobo) && BigInt(amountKobo) > 0n && (
                <p className="text-sm text-muted-foreground">
                  Split: retail {formatNaira(BigInt(amountKobo) / 2n)} · wholesale{" "}
                  {formatNaira(BigInt(amountKobo) - BigInt(amountKobo) / 2n)}
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
                  writeFlow.edit();
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
            <WriteFlowStatus
              flow={writeFlow}
              onRetry={() => {
                if (lastInput) createMutation.mutate(lastInput);
              }}
              checkHref="/expenses"
              checkLabel="Check expenses"
              showFieldErrors
            />
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
              disabled={network.offline || createMutation.isPending || writeFlow.status === "unknown" || categoriesQuery.isPending || accountsQuery.isPending}
            >
              {amendId ? "Void and recreate expense" : "Save expense"}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
