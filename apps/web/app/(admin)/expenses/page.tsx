"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Ban, Plus, Receipt, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import type { ExpenseListOptions, ExpenseRecordDto } from "@/lib/api/expenses.api";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { EffectiveRange, ReportRangeFields } from "@/components/reports/report-range";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { expensesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import {
  expenseRangePresets,
  mergeExpensePages,
  orderCategoryTotals,
  validateExpenseRange,
} from "@/lib/expense-filters";
import { queryKeys } from "@/lib/query-keys";
import { REPORT_STALE_MS } from "@/lib/report-range";

const CHANNEL_LABELS = {
  RETAIL: "Retail (Fridge)",
  WHOLESALE: "Wholesale",
  BOTH: "Both",
} as const;

const PAGE_SIZE = 50;

type ChannelFilter = ExpenseListOptions["channel"];
type SummaryView = "ALL" | "RETAIL" | "WHOLESALE";

function parseChannel(value: string | null): ChannelFilter {
  return value === "RETAIL" || value === "WHOLESALE" || value === "BOTH" ? value : undefined;
}

function parseView(value: string | null): SummaryView {
  return value === "RETAIL" || value === "WHOLESALE" ? value : "ALL";
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <ExpensesContent />
    </Suspense>
  );
}

function ExpensesContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const businessDate = useLagosBusinessDate();

  const urlFrom = searchParams.get("from") ?? businessDate;
  const urlTo = searchParams.get("to") ?? businessDate;
  const categoryId = searchParams.get("categoryId") ?? "";
  const channel = parseChannel(searchParams.get("channel"));
  const urlQ = searchParams.get("q") ?? "";
  const showVoided = searchParams.get("voided") !== "0";
  const summaryView = parseView(searchParams.get("view"));

  // The date inputs keep their own draft so half-typed dates never reach the URL or the API.
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const from = draft?.from ?? urlFrom;
  const to = draft?.to ?? urlTo;
  const rangeError = validateExpenseRange(from, to, businessDate);

  const [qText, setQText] = useState(urlQ);
  const debouncedQ = useDebouncedValue(qText, 300).trim();
  const [categorySearch, setCategorySearch] = useState("");

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [name, value] of Object.entries(patch)) {
        if (value === "") params.delete(name);
        else params.set(name, value);
      }
      const qs = params.toString();
      router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (debouncedQ !== urlQ) setParams({ q: debouncedQ });
  }, [debouncedQ, urlQ, setParams]);

  function changeRange(nextFrom: string, nextTo: string) {
    setDraft({ from: nextFrom, to: nextTo });
    if (validateExpenseRange(nextFrom, nextTo, businessDate) === null) {
      setDraft(null);
      setParams({ from: nextFrom, to: nextTo });
    }
  }

  const listFilters = useMemo(() => {
    const filters: ExpenseListOptions = { from, to, includeVoided: showVoided };
    if (categoryId !== "") filters.categoryId = categoryId;
    if (channel !== undefined) filters.channel = channel;
    if (debouncedQ !== "" && !isMockApiMode) filters.q = debouncedQ;
    return filters;
  }, [from, to, showVoided, categoryId, channel, debouncedQ]);

  const summaryFilters = useMemo(() => {
    const filters: ExpenseListOptions = { from, to };
    if (summaryView !== "ALL") filters.channel = summaryView;
    return filters;
  }, [from, to, summaryView]);

  const categories = useQuery({
    queryKey: queryKeys.expenses.categories(true),
    queryFn: async () => (await expensesApi.listCategories?.(true)) ?? [],
  });

  const expenses = useInfiniteQuery({
    queryKey: queryKeys.expenses.pages(listFilters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      expensesApi.listPage({ ...listFilters, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: rangeError === null,
    staleTime: REPORT_STALE_MS,
  });
  const loadMoreFailed = expenses.isFetchNextPageError;
  const listError: unknown = expenses.error;
  const fetchNext = expenses.fetchNextPage;

  const summary = useQuery({
    queryKey: queryKeys.expenses.summary(summaryFilters),
    queryFn: () => expensesApi.summary(summaryFilters),
    enabled: rangeError === null,
    staleTime: REPORT_STALE_MS,
  });

  const rows = useMemo(
    () => mergeExpensePages(expenses.data?.pages ?? []),
    [expenses.data],
  );
  const firstPage = expenses.data?.pages[0];
  const categoryList = categories.data ?? [];
  const categoryById = new Map(categoryList.map((category) => [category.id, category]));
  const byCategory = orderCategoryTotals(summary.data?.byCategory ?? []);

  const categoryNeedle = categorySearch.trim().toLowerCase();
  const categoryOptions = [...categoryList]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (category) =>
        categoryNeedle === "" ||
        category.name.toLowerCase().includes(categoryNeedle) ||
        category.id === categoryId,
    );

  const writeFlow = useWriteFlow();
  const [voidTarget, setVoidTarget] = useState<ExpenseRecordDto | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const [lastVoid, setLastVoid] = useState<{ id: string; reason: string } | null>(null);

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
    { header: "Date", render: (e) => formatLagosDate(e.expenseDate) },
    { header: "Channel", render: (e) => CHANNEL_LABELS[e.channel] },
    { header: "Category", render: (e) => e.categoryName },
    { header: "Description", render: (e) => e.description },
    {
      header: "Amount",
      align: "right",
      render: (e) => <Money kobo={e.amountKobo} tone="neutral" />,
    },
    {
      header: "Status",
      render: (expense) =>
        expense.systemManaged
          ? "Automatic"
          : !expense.voided
            ? "Active"
            : `Voided: ${expense.voidReason}`,
    },
    {
      header: "Actions",
      align: "right",
      render: (e) =>
        e.systemManaged || categoryById.get(e.categoryId)?.code === "LOAN_INTEREST" ? (
          <span className="text-xs text-muted-foreground">
            Automatic — managed with the loan repayment
          </span>
        ) : e.voided ? (
          <span className="text-xs text-muted-foreground">Voided</span>
        ) : (
          <div className="flex justify-end gap-2">
            {!isMockApiMode && (
              <Link
                href={`/expenses/new?${new URLSearchParams({
                  amendId: e.id,
                  categoryId: e.categoryId,
                  channel: e.channel,
                  description: e.description,
                  amountKobo: e.amountKobo,
                  // The form needs YYYY-MM-DD; formatLagosDate gives a display string.
                  expenseDate: getLagosBusinessDate(new Date(e.expenseDate)),
                  accountId: e.accountId ?? "",
                }).toString()}`}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                Amend
              </Link>
            )}
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
          <div className="flex flex-wrap gap-2">
            {!isMockApiMode && (
              <Link
                href="/expenses/categories"
                className={buttonClasses({ variant: "secondary" })}
              >
                <Settings2 aria-hidden="true" className="h-4 w-4" />
                Manage categories
              </Link>
            )}
            <Link href="/expenses/new" className={buttonClasses()}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add expense
            </Link>
          </div>
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

      <Card>
        <CardBody className="space-y-4">
          <ReportRangeFields
            idPrefix="expenses"
            from={from}
            to={to}
            businessDate={businessDate}
            error={rangeError}
            presets={expenseRangePresets(businessDate)}
            onChange={changeRange}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id="expenses-category" label="Category">
              {categoryList.length > 8 && (
                <Input
                  aria-label="Search categories"
                  placeholder="Search categories"
                  value={categorySearch}
                  onChange={(event) => setCategorySearch(event.target.value)}
                />
              )}
              <Select
                id="expenses-category"
                value={categoryId}
                onChange={(event) => setParams({ categoryId: event.target.value })}
              >
                <option value="">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="expenses-channel" label="Channel">
              <Select
                id="expenses-channel"
                value={channel ?? ""}
                onChange={(event) => setParams({ channel: event.target.value })}
              >
                <option value="">All channels</option>
                <option value="RETAIL">Retail (Fridge)</option>
                <option value="WHOLESALE">Wholesale</option>
                <option value="BOTH">Both</option>
              </Select>
            </FormField>
            <FormField
              id="expenses-search"
              label="Search"
              hint={isMockApiMode ? "Not available with demo data" : undefined}
            >
              <Input
                id="expenses-search"
                value={qText}
                maxLength={100}
                disabled={isMockApiMode}
                placeholder="Description"
                onChange={(event) => setQText(event.target.value)}
              />
            </FormField>
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(event) => setParams({ voided: event.target.checked ? "" : "0" })}
              />
              Show voided
            </label>
          </div>
        </CardBody>
      </Card>

      {rangeError === null && (
        <section className="space-y-3" aria-label="Summary">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="max-w-xs flex-1">
              <FormField
                id="expenses-summary-view"
                label="Summary view"
                hint="Summary covers the date range only (not the filters below). Voided expenses are never counted."
              >
                <Select
                  id="expenses-summary-view"
                  value={summaryView}
                  onChange={(event) =>
                    setParams({ view: event.target.value === "ALL" ? "" : event.target.value })
                  }
                >
                  <option value="ALL">All expenses, as recorded</option>
                  <option value="RETAIL">Retail share</option>
                  <option value="WHOLESALE">Wholesale share</option>
                </Select>
              </FormField>
            </div>
            {summary.data?.from && summary.data.to && (
              <EffectiveRange from={summary.data.from} to={summary.data.to} />
            )}
          </div>
          {summaryView !== "ALL" && (
            <p className="text-xs text-muted-foreground">
              “Both” expenses are split between Retail and Wholesale by the server; this view
              shows the {summaryView === "RETAIL" ? "retail" : "wholesale"} half.
            </p>
          )}
          {summary.isPending ? (
            <Skeleton variant="row" count={3} />
          ) : summary.isError ? (
            <ErrorState
              title="Expense summary could not be loaded"
              message={toUserMessage(summary.error)}
              onRetry={() => void summary.refetch()}
            />
          ) : (
            <>
              <StatCard
                label={`Total expenses (${summary.data.count})`}
                value={<Money kobo={summary.data.totalKobo} tone="neutral" />}
                icon={Receipt}
              />
              {byCategory.length > 0 && (
                <Card>
                  <CardBody>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 font-medium">Category</th>
                          <th className="py-1 text-right font-medium">Expenses</th>
                          <th className="py-1 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byCategory.map((row) => (
                          <tr
                            key={row.id}
                            className="cursor-pointer border-t border-border hover:bg-muted"
                            onClick={() => setParams({ categoryId: row.id })}
                          >
                            <td className="py-2">
                              <button
                                type="button"
                                className="text-left font-medium underline-offset-2 hover:underline"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setParams({ categoryId: row.id });
                                }}
                              >
                                {row.name}
                              </button>{" "}
                              {categoryById.get(row.id)?.code === "LOAN_INTEREST" && (
                                <Badge tone="info">Automatic</Badge>
                              )}
                            </td>
                            <td className="py-2 text-right">{row.count}</td>
                            <td className="py-2 text-right">
                              <Money kobo={row.totalKobo} tone="neutral" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </section>
      )}

      <section className="space-y-3" aria-label="Expense list">
        {rangeError !== null ? null : expenses.isPending ? (
          <Skeleton variant="row" count={5} />
        ) : expenses.isError && !loadMoreFailed ? (
          <ErrorState
            title="Expenses could not be loaded"
            message={toUserMessage(listError)}
            onRetry={() => void expenses.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expenses match"
            description="Change the dates or filters, or add an expense."
            action={
              <Link href="/expenses/new" className={buttonClasses({ variant: "secondary" })}>
                Add expense
              </Link>
            }
          />
        ) : (
          <>
            {firstPage?.from && firstPage.to && (
              <EffectiveRange from={firstPage.from} to={firstPage.to} />
            )}
            <p className="text-sm text-muted-foreground">
              {expenses.hasNextPage
                ? `Showing ${rows.length} of the expenses in this range; load more to see the rest.`
                : `Showing all ${rows.length} expenses in this range.`}
            </p>
            <ResponsiveTable rows={rows} columns={columns} getKey={(e) => e.id} />
            {loadMoreFailed && (
              <ErrorState
                title="More expenses could not be loaded"
                message={toUserMessage(listError)}
                onRetry={() => void fetchNext()}
              />
            )}
            {expenses.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  loading={expenses.isFetchingNextPage}
                  onClick={() => void fetchNext()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
