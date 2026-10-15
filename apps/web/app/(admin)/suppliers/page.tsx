"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import type { CreateSupplierDto, SupplierDto } from "@fabtyna/shared";
import { FormModal } from "@/components/form-modal";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/responsive-table";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { suppliersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.suppliersSearch);
  const showDeleted = useUIStore((state) => state.filters.suppliersShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierDto>();

  const debouncedSearch = useDebouncedValue(search, 250);

  const suppliers = useQuery({
    queryKey: queryKeys.suppliers.list(debouncedSearch, showDeleted),
    queryFn: () =>
      suppliersApi.list({ search: debouncedSearch, includeDeleted: showDeleted }),
    placeholderData: keepPreviousData,
  });

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CreateSupplierDto;
    }) => (id ? suppliersApi.update(id, input) : suppliersApi.create(input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      closeForm();
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, id }: { action: "delete" | "restore"; id: string }) =>
      action === "delete" ? suppliersApi.softDelete(id) : suppliersApi.restore(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingSupplier(undefined);
    saveMutation.reset();
  }

  function openCreate() {
    setEditingSupplier(undefined);
    saveMutation.reset();
    setFormOpen(true);
  }

  function openEdit(supplier: SupplierDto) {
    setEditingSupplier(supplier);
    saveMutation.reset();
    setFormOpen(true);
  }

  async function save(input: CreateSupplierDto) {
    await saveMutation.mutateAsync({ id: editingSupplier?.id, input });
  }

  function deleteSupplier(supplier: SupplierDto) {
    if (
      !window.confirm(
        `Delete ${supplier.name}? It will be hidden from lists and can be restored later.`,
      )
    ) {
      return;
    }
    actionMutation.mutate({ action: "delete", id: supplier.id });
  }

  function restoreSupplier(supplier: SupplierDto) {
    actionMutation.mutate({ action: "restore", id: supplier.id });
  }

  const columns: ResponsiveTableColumn<SupplierDto>[] = [
    {
      header: "Supplier",
      render: (supplier) => (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{supplier.name}</p>
          <p className="text-xs text-muted-foreground">
            {supplier.address ?? "No address"}
          </p>
        </div>
      ),
    },
    {
      header: "Phone",
      render: (supplier) => (
        <span className="text-sm text-muted-foreground">
          {supplier.phone ?? "—"}
        </span>
      ),
    },
    {
      header: "Email",
      render: (supplier) => (
        <span className="text-sm text-muted-foreground truncate block max-w-[220px]">
          {supplier.email ?? "—"}
        </span>
      ),
    },
    {
      header: "Notes",
      render: (supplier) => (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[250px]">
          {supplier.notes ?? "—"}
        </span>
      ),
    },
    {
      header: "Actions",
      render: (supplier) =>
        supplier.deletedAt ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => restoreSupplier(supplier)}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Restore
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEdit(supplier)}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => deleteSupplier(supplier)}
              className="h-8 rounded-md border border-destructive/20 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Suppliers
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep supplier contact details in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add supplier
        </button>
      </div>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1 max-w-md">
            <span className="sr-only">Search suppliers</span>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setFilter("suppliersSearch", event.target.value)}
              placeholder="Search by name, phone or email..."
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label className="inline-flex h-9 items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) =>
                setFilter("suppliersShowDeleted", event.target.checked)
              }
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            Show deleted
          </label>
        </div>

        {actionMutation.error && (
          <p role="alert" className="text-xs text-destructive">
            {actionMutation.error.message}
          </p>
        )}

        {suppliers.isPending ? (
          <ListLoading />
        ) : suppliers.isError ? (
          <ListError
            message={suppliers.error.message || "Suppliers could not be loaded."}
            retry={() => void suppliers.refetch()}
          />
        ) : suppliers.data.length === 0 ? (
          <ListEmpty
            message={
              showDeleted
                ? "No deleted suppliers match this search."
                : "Add a supplier to keep their details readily available."
            }
          />
        ) : (
          <ResponsiveTable
            rows={suppliers.data}
            columns={columns}
            getKey={(supplier) => supplier.id}
          />
        )}
      </section>

      {formOpen && (
        <FormModal
          title={editingSupplier ? "Edit supplier" : "Add supplier"}
          onClose={closeForm}
        >
          <SupplierForm
            key={editingSupplier?.id ?? "new-supplier"}
            supplier={editingSupplier}
            error={saveMutation.error?.message}
            pending={saveMutation.isPending}
            onCancel={closeForm}
            onSubmit={save}
          />
        </FormModal>
      )}
    </div>
  );
}