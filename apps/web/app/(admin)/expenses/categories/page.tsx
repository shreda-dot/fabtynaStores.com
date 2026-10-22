"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { expensesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { filterCategories, type CategoryStatusFilter } from "@/lib/expense-filters";
import { invalidateReportsAndBalances } from "@/lib/invalidate-after-write";
import { queryKeys } from "@/lib/query-keys";

const PAGE_SIZE = 20;

type Operation =
  | { kind: "create"; name: string }
  | { kind: "rename"; id: string; name: string }
  | { kind: "active"; id: string; isActive: boolean };

export default function ExpenseCategoriesPage() {
  const queryClient = useQueryClient();
  const flow = useWriteFlow();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [lastOperation, setLastOperation] = useState<Operation | null>(null);
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText);
  const [status, setStatus] = useState<CategoryStatusFilter>("ALL");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const categories = useQuery({
    queryKey: queryKeys.expenses.categories(true),
    queryFn: async () => (await expensesApi.listCategories?.(true)) ?? [],
    enabled: !isMockApiMode,
  });

  const mutation = useMutation({
    mutationFn: async (operation: Operation) => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastOperation);
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastOperation(operation);
      return flow.run(async (key) => {
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all }),
        invalidateReportsAndBalances(queryClient),
      ]);
      setName("");
      setEditingId("");
    },
  });

  const busy = mutation.isPending || flow.status === "unknown";
  const filtered = filterCategories(categories.data ?? [], { search, status, limit });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    mutation.mutate(
      editingId
        ? { kind: "rename", id: editingId, name: trimmed }
        : { kind: "create", name: trimmed },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense categories"
        description="Create, rename, deactivate and reactivate categories. Categories are never deleted."
        actions={
          <Link href="/expenses" className={buttonClasses({ variant: "secondary" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to expenses
          </Link>
        }
      />

      {isMockApiMode ? (
        <EmptyState
          title="Not available with demo data"
          description="Category management needs the real server. Switch the app to real mode to use it."
        />
      ) : (
        <>
          <Card>
            <CardBody className="space-y-3">
              <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
                <FormField
                  id="category-name"
                  label={editingId ? "Rename category" : "New category"}
                  className="flex-1"
                >
                  <Input
                    id="category-name"
                    value={name}
                    maxLength={60}
                    placeholder={editingId ? "New name" : "Category name"}
                    onChange={(event) => {
                      flow.edit();
                      setName(event.target.value);
                    }}
                  />
                </FormField>
                <div className="flex gap-2">
                  <Button type="submit" loading={mutation.isPending} disabled={busy}>
                    {editingId ? "Save name" : "Add category"}
                  </Button>
                  {editingId && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setEditingId("");
                        setName("");
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
              <WriteFlowStatus
                flow={flow}
                onRetry={() => {
                  if (lastOperation) mutation.mutate(lastOperation);
                }}
                checkHref="/expenses/categories"
                checkLabel="Check categories"
                showFieldErrors
              />
              {mutation.isError && (
                <p role="alert" className="text-sm text-danger">
                  {toUserMessage(mutation.error)}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <FormField id="category-search" label="Search">
                <Input
                  id="category-search"
                  value={searchText}
                  placeholder="Search categories"
                  onChange={(event) => {
                    setSearchText(event.target.value);
                    setLimit(PAGE_SIZE);
                  }}
                />
              </FormField>
              <FormField id="category-status" label="Show">
                <Select
                  id="category-status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as CategoryStatusFilter);
                    setLimit(PAGE_SIZE);
                  }}
                >
                  <option value="ALL">All categories</option>
                  <option value="ACTIVE">Active only</option>
                  <option value="INACTIVE">Inactive only</option>
                </Select>
              </FormField>
            </CardBody>
          </Card>

          {categories.isPending ? (
            <Skeleton variant="row" count={4} />
          ) : categories.isError ? (
            <ErrorState
              title="Categories could not be loaded"
              message={toUserMessage(categories.error)}
              onRetry={() => void categories.refetch()}
            />
          ) : filtered.total === 0 ? (
            <EmptyState
              title="No categories match"
              description="Change the search or the active/inactive filter."
            />
          ) : (
            <Card>
              <CardBody className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Showing {filtered.items.length} of {filtered.total} categories.
                </p>
                <ul className="divide-y divide-border">
                  {filtered.items.map((category) => (
                    <li
                      key={category.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        {category.name}
                        {category.code !== null && <Badge tone="info">System</Badge>}
                        {!category.isActive && <Badge>Inactive</Badge>}
                        <span className="text-xs text-muted-foreground">
                          {category.expenseCount} expense{category.expenseCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      {category.code === null && (
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!category.isActive || busy}
                            onClick={() => {
                              flow.edit();
                              setEditingId(category.id);
                              setName(category.name);
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              flow.edit();
                              mutation.mutate({
                                kind: "active",
                                id: category.id,
                                isActive: !category.isActive,
                              });
                            }}
                          >
                            {category.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {filtered.total > filtered.items.length && (
                  <div className="flex justify-center">
                    <Button variant="secondary" onClick={() => setLimit(limit + PAGE_SIZE)}>
                      Show 20 more
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
