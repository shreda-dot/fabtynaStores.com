"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import type { CreateSupplierDto, SupplierDto } from "@fabtyna/shared";
import { FormModal } from "@/components/form-modal";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/responsive-table";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { suppliersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.suppliersSearch);
  const showDeleted = useUIStore((state) => state.filters.suppliersShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);
  const activeModal = useUIStore((state) => state.activeModal);
  const setActiveModal = useUIStore((state) => state.setActiveModal);
  const [editingSupplier, setEditingSupplier] = useState<SupplierDto>();

  const suppliers = useQuery({
    queryKey: queryKeys.suppliers.list(search, showDeleted),
    queryFn: () => suppliersApi.list({ search, includeDeleted: showDeleted }),
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
    setActiveModal(null);
    setEditingSupplier(undefined);
    saveMutation.reset();
  }

  function openCreate() {
    setEditingSupplier(undefined);
    saveMutation.reset();
    setActiveModal("supplier");
  }

  function openEdit(supplier: SupplierDto) {
    setEditingSupplier(supplier);
    saveMutation.reset();
    setActiveModal("supplier");
  }

  async function save(input: CreateSupplierDto) {
    await saveMutation.mutateAsync({ id: editingSupplier?.id, input });
  }

  function deleteSupplier(supplier: SupplierDto) {
    if (!window.confirm(`Soft-delete ${supplier.name}? It can be restored later.`)) return;
    actionMutation.mutate({ action: "delete", id: supplier.id });
  }

  function restoreSupplier(supplier: SupplierDto) {
    actionMutation.mutate({ action: "restore", id: supplier.id });
  }

  const columns: ResponsiveTableColumn<SupplierDto>[] = [
    {
      header: "Supplier",
      render: (supplier) => (
        <div>
          <p className="font-medium">{supplier.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {supplier.address ?? "No address"}
          </p>
        </div>
      ),
    },
    { header: "Phone", render: (supplier) => supplier.phone ?? "—" },
    { header: "Email", render: (supplier) => supplier.email ?? "—" },
    { header: "Notes", render: (supplier) => supplier.notes ?? "—" },
    {
      header: "Actions",
      render: (supplier) =>
        supplier.deletedAt ? (
          <button
            type="button"
            disabled={actionMutation.isPending}
            onClick={() => restoreSupplier(supplier)}
            className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            Restore
          </button>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => openEdit(supplier)}
              className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => deleteSupplier(supplier)}
              className="min-h-11 rounded-md border border-border px-3 text-sm font-medium text-destructive hover:bg-muted disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep supplier contact details in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add supplier
        </button>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search suppliers</span>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setFilter("suppliersSearch", event.target.value)}
              placeholder="Search by name, phone or email"
              className="min-h-12 w-full rounded-md border border-input bg-background pl-10 pr-3 text-base"
            />
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) =>
                setFilter("suppliersShowDeleted", event.target.checked)
              }
              className="h-4 w-4 accent-primary"
            />
            Show deleted
          </label>
        </div>

        {actionMutation.error && (
          <p role="alert" className="text-sm text-destructive">
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

      {activeModal === "supplier" && (
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
