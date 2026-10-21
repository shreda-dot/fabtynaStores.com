"use client";

import { useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Search, Truck } from "lucide-react";
import Link from "next/link";
import type { CreateSupplierDto } from "@fabtyna/shared";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { suppliersApi } from "@/lib/api";
import {
  apiFieldErrors,
  toTechnicalDetail,
  toUserMessage,
} from "@/lib/api/client";
import { createIdempotencyIntent, type IdempotencyIntent } from "@/lib/api/idempotency-intent";
import type {
  SupplierFormDto,
  SupplierListItemDto,
} from "@/lib/api/suppliers.api";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
import { useUIStore } from "@/stores/ui-store";

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.suppliersSearch);
  const showInactive = useUIStore((state) => state.filters.suppliersShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);
  const [balanceFilter, setBalanceFilter] = useState<"all" | "with" | "without">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierFormDto>();
  const [loadingEdit, setLoadingEdit] = useState(false);
  const saveIntent = useRef(createIdempotencyIntent());
  const actionIntents = useRef(new Map<string, IdempotencyIntent>());
  const debouncedSearch = useDebouncedValue(search, 250);

  const suppliers = useInfiniteQuery({
    queryKey: queryKeys.suppliers.list(debouncedSearch, showInactive, balanceFilter),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      return suppliersApi.listPage({
        search: debouncedSearch,
        includeDeleted: showInactive,
        withBalance: balanceFilter === "all" ? undefined : balanceFilter === "with",
        cursor: pageParam,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const supplierRows = suppliers.data?.pages.flatMap((page) => page.items) ?? [];

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
      key,
    }: {
      id?: string;
      input: CreateSupplierDto;
      key: string;
    }) =>
      id
        ? suppliersApi.update(id, input, key)
        : suppliersApi.create(input, key),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      saveIntent.current.markSucceeded();
      closeForm();
    },
  });
  const actionMutation = useMutation({
    mutationFn: ({
      action,
      id,
      key,
    }: {
      action: "deactivate" | "reactivate";
      id: string;
      key: string;
    }) =>
      action === "deactivate"
        ? suppliersApi.softDelete(id, key)
        : suppliersApi.restore(id, key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingSupplier(undefined);
    saveMutation.reset();
    saveIntent.current.reset();
  }

  function openCreate() {
    setEditingSupplier(undefined);
    saveMutation.reset();
    saveIntent.current.reset();
    setFormOpen(true);
  }

  async function openEdit(row: SupplierListItemDto) {
    setLoadingEdit(true);
    try {
      const profile = await suppliersApi.getById(row.id);
      setEditingSupplier({ ...profile.supplier, id: profile.supplier.id });
      saveMutation.reset();
      saveIntent.current.reset();
      setFormOpen(true);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setLoadingEdit(false);
    }
  }

  async function save(input: CreateSupplierDto) {
    await saveMutation.mutateAsync({
      id: editingSupplier?.id,
      input,
      key: saveIntent.current.getKey(),
    });
  }

  async function setSupplierActive(row: SupplierListItemDto, active: boolean) {
    const intentId = `${active ? "reactivate" : "deactivate"}:${row.id}`;
    const intent =
      actionIntents.current.get(intentId) ?? createIdempotencyIntent();
    actionIntents.current.set(intentId, intent);
    const confirmed = await confirm({
      title: `${active ? "Reactivate" : "Deactivate"} ${row.name}?`,
      description: active
        ? "The supplier will appear in active supplier lists again."
        : "The supplier will be hidden from active lists. Its history is retained.",
      confirmLabel: active ? "Reactivate supplier" : "Deactivate supplier",
      tone: active ? "normal" : "danger",
    });
    if (!confirmed) return;
    try {
      await actionMutation.mutateAsync({
        action: active ? "reactivate" : "deactivate",
        id: row.id,
        key: intent.getKey(),
      });
      intent.markSucceeded();
      actionIntents.current.delete(intentId);
      toast.success(`${row.name} ${active ? "reactivated" : "deactivated"}`);
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  }

  const columns: ResponsiveTableColumn<SupplierListItemDto>[] = [
    {
      header: "Supplier",
      render: (row) => (
        <Link href={`/suppliers/${row.id}`} className="font-medium text-primary hover:underline">
          {row.name}
        </Link>
      ),
    },
    { header: "Phone", render: (row) => row.phone ?? "—" },
    { header: "Email", render: (row) => row.email ?? "—" },
    {
      header: "Balance owed",
      align: "right",
      render: (row) => <Money kobo={row.balanceKobo ?? "0"} tone="auto" />,
    },
    {
      header: "Status",
      align: "center",
      render: (row) => (
        <StatusBadge status={row.active === false || row.deletedAt ? "Inactive" : "Active"} />
      ),
    },
    {
      header: "Actions",
      align: "right",
      render: (row) => {
        const active = row.active ?? !row.deletedAt;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {active && (
              <Button
                variant="secondary"
                size="sm"
                disabled={loadingEdit}
                onClick={() => void openEdit(row)}
              >
                Edit
              </Button>
            )}
            <Button
              variant={active ? "danger" : "secondary"}
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void setSupplierActive(row, !active)}
            >
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Keep supplier contact details and outstanding balances in one place."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add supplier
          </Button>
        }
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="relative min-w-0">
              <span className="sr-only">Search suppliers</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setFilter("suppliersSearch", event.target.value)}
                placeholder="Search by name or phone"
                className="pl-9"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setFilter("suppliersShowDeleted", event.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Show inactive suppliers
            </label>
            <Select
              aria-label="Filter suppliers by balance"
              value={balanceFilter}
              onChange={(event) =>
                setBalanceFilter(event.target.value as "all" | "with" | "without")
              }
            >
              <option value="all">All balances</option>
              <option value="with">With balance</option>
              <option value="without">No balance</option>
            </Select>
          </div>
          {suppliers.isPending ? (
            <Skeleton variant="row" count={5} />
          ) : suppliers.isError ? (
            <ErrorState
              message={toUserMessage(suppliers.error)}
              detail={
                process.env.NODE_ENV === "development"
                  ? toTechnicalDetail(suppliers.error)
                  : undefined
              }
              onRetry={() => void suppliers.refetch()}
            />
          ) : supplierRows.length === 0 ? (
            <EmptyState
              icon={Truck}
              title={showInactive ? "No inactive suppliers" : "No suppliers yet"}
              description={
                showInactive
                  ? "No inactive suppliers match these filters."
                  : "Add a supplier to keep their details readily available."
              }
              action={
                showInactive ? undefined : (
                  <Button onClick={openCreate}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add supplier
                  </Button>
                )
              }
            />
          ) : (
            <>
              <ResponsiveTable
                rows={supplierRows}
                columns={columns}
                getKey={(row) => row.id}
              />
              {suppliers.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    disabled={suppliers.isFetchingNextPage}
                    onClick={() => void suppliers.fetchNextPage()}
                  >
                    {suppliers.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingSupplier ? "Edit supplier" : "Add supplier"}
        size="lg"
        busy={saveMutation.isPending}
      >
        <SupplierForm
          key={editingSupplier?.id ?? "new-supplier"}
          supplier={editingSupplier}
          fieldErrors={apiFieldErrors(saveMutation.error)}
          error={saveMutation.error ? toUserMessage(saveMutation.error) : undefined}
          pending={saveMutation.isPending}
          onCancel={closeForm}
          onEdit={() => {
            saveIntent.current.reset();
            saveMutation.reset();
          }}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
