"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, Ban } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDate,
  getLagosBusinessDate,
} from "@fabtyna/shared";
import type { ExpenseCategoryDto, ExpenseRecordDto } from "@/lib/api/expenses.api";
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
import { isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { WriteFlowStatus } from "@/components/write-flow-status";

const CHANNEL_LABELS = {
  RETAIL: "Retail (Fridge)",
  WHOLESALE: "Wholesale",
  BOTH: "Both",
} as const;

export default function ExpensesPage() {
  const queryClient = useQueryClient();

  const [filterDate, setFilterDate] = useState(() => getLagosBusinessDate());
  const [voidTarget, setVoidTarget] = useState<ExpenseRecordDto | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const businessDate = useLagosBusinessDate();
  const writeFlow = useWriteFlow();
  const [lastVoid, setLastVoid] = useState<{ id: string; reason: string } | null>(null);
  const categoryFlow = useWriteFlow();
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [lastCategoryOperation, setLastCategoryOperation] = useState<
    { kind: "create"; name: string } |
    { kind: "rename"; id: string; name: string } |
    { kind: "active"; id: string; isActive: boolean } | null
  >(null);

  const expenses = useQuery({
    queryKey: queryKeys.expenses.list(filterDate, filterDate),
    queryFn: () => expensesApi.list({ from: filterDate, to: filterDate, includeVoided: true }),
  });
  const summary = useQuery({
    queryKey: [...queryKeys.expenses.list(filterDate, filterDate), "summary"],
    queryFn: () => expensesApi.summary({ from: filterDate, to: filterDate }),
  });
  const categories = useQuery({
    queryKey: [...queryKeys.expenses.all, "categories"],
    queryFn: async (): Promise<ExpenseCategoryDto[]> =>
      (await expensesApi.listCategories?.(true)) ?? [],
  });

  const voidMutation = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      setLastVoid(input);
      if (isMockApiMode) return expensesApi.void(input.id, input.reason);
      return writeFlow.run((key) => expensesApi.void(input.id, input.reason, key));
    },
    onSuccess: (result) => {
      if (!result) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      setVoidTarget(null);
      setVoidReason("");
      setVoidError("");
    },
  });
  const categoryMutation = useMutation({
    mutationFn: async (operation: NonNullable<typeof lastCategoryOperation>) => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastCategoryOperation);
      if (categoryFlow.status === "unknown" && !isRetry) return undefined;
      if (categoryFlow.status === "failed" && !isRetry) categoryFlow.edit();
      setLastCategoryOperation(operation);
      return categoryFlow.run(async (key) => {
        if (operation.kind === "create") {
          if (!expensesApi.createCategory) throw new Error("Category creation is unavailable.");
          return expensesApi.createCategory(operation.name, key);
        }
        if (operation.kind === "rename") {
          if (!expensesApi.renameCategory) throw new Error("Category renaming is unavailable.");
          return expensesApi.renameCategory(operation.id, operation.name, key);
        }
        if (!expensesApi.setCategoryActive) throw new Error("Category activation is unavailable.");
        return expensesApi.setCategoryActive(operation.id, operation.isActive, key);
      });
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: [...queryKeys.expenses.all, "categories"] });
      setCategoryName("");
      setEditingCategoryId("");
    },
  });

  const rows = expenses.data ?? [];
  const categoryById = new Map((categories.data ?? []).map((category) => [category.id, category]));
  const totalKobo = BigInt(summary.data?.totalKobo ?? "0");

  function requestVoid(expense: ExpenseRecordDto) {
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

  const columns: ResponsiveTableColumn<ExpenseRecordDto>[] = [
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
      render: (e) => e.categoryName,
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
        !expense.voided ? "Active" : `Voided: ${expense.voidReason}`,
    },
    {
      header: "Actions",
      align: "right",
      render: (e) =>
        e.voided ? (
          <span className="text-xs text-muted-foreground">Voided</span>
        ) : categoryById.get(e.categoryId)?.code === "LOAN_INTEREST" ? (
          <span className="text-xs text-muted-foreground">
            Managed with loan repayment
          </span>
        ) : (
          <div className="flex justify-end gap-2">
            {!isMockApiMode && <Link
              href={`/expenses/new?${new URLSearchParams({
                amendId: e.id,
                categoryId: e.categoryId,
                channel: e.channel,
                description: e.description,
                amountKobo: e.amountKobo,
                expenseDate: formatLagosDate(e.expenseDate),
                accountId: e.accountId,
              }).toString()}`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Amend
            </Link>}
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10"
              onClick={() => requestVoid(e)}
            >
              <Ban aria-hidden="true" className="h-4 w-4" />
              Void
            </Button>
          </div>
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
                onChange={(event) => {
                  writeFlow.edit();
                  setVoidReason(event.target.value);
                }}
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
            <WriteFlowStatus
              flow={writeFlow}
              onRetry={() => {
                if (lastVoid) voidMutation.mutate(lastVoid);
              }}
              checkHref="/expenses"
              checkLabel="Check expenses"
              showFieldErrors
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={voidMutation.isPending || writeFlow.status === "unknown"}
                onClick={() => setVoidTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                loading={voidMutation.isPending}
                disabled={voidMutation.isPending || writeFlow.status === "unknown"}
              >
                Void expense
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <StatCard
        label="Expenses on selected date"
        value={<Money kobo={totalKobo} tone="neutral" />}
        icon={Receipt}
      />
      {!isMockApiMode && (
        <Card>
          <CardBody className="space-y-4">
            <h2 className="font-semibold">Expense categories</h2>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                const name = categoryName.trim();
                if (!name) return;
                categoryMutation.mutate(
                  editingCategoryId
                    ? { kind: "rename", id: editingCategoryId, name }
                    : { kind: "create", name },
                );
              }}
            >
              <Textarea
                aria-label="Category name"
                value={categoryName}
                rows={1}
                maxLength={60}
                onChange={(event) => {
                  categoryFlow.edit();
                  setCategoryName(event.target.value);
                }}
                placeholder={editingCategoryId ? "Rename category" : "New category name"}
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  loading={categoryMutation.isPending}
                  disabled={categoryMutation.isPending || categoryFlow.status === "unknown"}
                >
                  {editingCategoryId ? "Save name" : "Add category"}
                </Button>
                {editingCategoryId && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => { setEditingCategoryId(""); setCategoryName(""); }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
            {categories.isPending ? (
              <Skeleton variant="row" count={2} />
            ) : categories.isError ? (
              <ErrorState
                title="Categories could not be loaded"
                message={toUserMessage(categories.error)}
                onRetry={() => void categories.refetch()}
              />
            ) : (
              <ul className="divide-y divide-border">
                {(categories.data ?? []).map((category) => (
                  <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>{category.name}{category.isActive ? "" : " (inactive)"}</span>
                    <span className="flex gap-2">
                      {category.code === null && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!category.isActive || categoryMutation.isPending || categoryFlow.status === "unknown"}
                            onClick={() => {
                              setEditingCategoryId(category.id);
                              setCategoryName(category.name);
                              categoryFlow.edit();
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={categoryMutation.isPending || categoryFlow.status === "unknown"}
                            onClick={() => {
                              categoryFlow.edit();
                              categoryMutation.mutate({
                                kind: "active",
                                id: category.id,
                                isActive: !category.isActive,
                              });
                            }}
                          >
                            {category.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <WriteFlowStatus
              flow={categoryFlow}
              onRetry={() => {
                if (lastCategoryOperation) categoryMutation.mutate(lastCategoryOperation);
              }}
              checkHref="/expenses"
              checkLabel="Check categories"
              showFieldErrors
            />
            {categoryMutation.isError && (
              <p role="alert" className="text-sm text-danger">{toUserMessage(categoryMutation.error)}</p>
            )}
          </CardBody>
        </Card>
      )}
      {summary.isError && (
        <ErrorState
          title="Expense summary could not be loaded"
          message={toUserMessage(summary.error)}
          onRetry={() => void summary.refetch()}
        />
      )}

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
