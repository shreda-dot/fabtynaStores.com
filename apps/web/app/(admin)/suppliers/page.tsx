"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Search, Truck } from "lucide-react";
import type { CreateSupplierDto, SupplierDto } from "@fabtyna/shared";
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
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { suppliersApi } from "@/lib/api";
import { toTechnicalDetail, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
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
    mutationFn: ({ id, input }: { id?: string; input: CreateSupplierDto }) =>
      id ? suppliersApi.update(id, input) : suppliersApi.create(input),
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

  async function runAction(action: "delete" | "restore", supplier: SupplierDto) {
    const isDelete = action === "delete";
    const ok = await confirm({
      title: isDelete ? `Delete ${supplier.name}?` : `Restore ${supplier.name}?`,
      description: isDelete
        ? "The supplier will be hidden from lists and can be restored later."
        : "The supplier will appear in the supplier list again.",
      confirmLabel: isDelete ? "Delete supplier" : "Restore",
      tone: isDelete ? "danger" : "normal",
    });
    if (!ok) return;
    try {
      await actionMutation.mutateAsync({ action, id: supplier.id });
      toast.success(
        isDelete ? `${supplier.name} deleted` : `${supplier.name} restored`,
      );
    } catch (err) {
      toast.error(toUserMessage(err));
    }
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
        <span className="block max-w-[220px] truncate text-sm text-muted-foreground">
          {supplier.email ?? "—"}
        </span>
      ),
    },
    {
      header: "Notes",
      render: (supplier) => (
        <span className="line-clamp-2 max-w-[250px] text-sm text-muted-foreground">
          {supplier.notes ?? "—"}
        </span>
      ),
    },
    {
      header: "Status",
      align: "center",
      render: (supplier) => (
        <StatusBadge status={supplier.deletedAt ? "Deleted" : "Active"} />
      ),
    },
    {
      header: "Actions",
      align: "right",
      render: (supplier) =>
        supplier.deletedAt ? (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void runAction("restore", supplier)}
            >
              Restore
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => openEdit(supplier)}>
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void runAction("delete", supplier)}
            >
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Keep supplier contact details in one place."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add supplier
          </Button>
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1 sm:max-w-md">
              <span className="sr-only">Search suppliers</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setFilter("suppliersSearch", event.target.value)}
                placeholder="Search by name, phone or email..."
                className="pl-9"
              />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(event) =>
                  setFilter("suppliersShowDeleted", event.target.checked)
                }
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Show deleted
            </label>
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
          ) : suppliers.data.length === 0 ? (
            <EmptyState
              icon={Truck}
              title={showDeleted ? "No deleted suppliers" : "No suppliers yet"}
              description={
                showDeleted
                  ? "No deleted suppliers match this search."
                  : "Add a supplier to keep their details readily available."
              }
              action={
                showDeleted ? undefined : (
                  <Button onClick={openCreate}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add supplier
                  </Button>
                )
              }
            />
          ) : (
            <ResponsiveTable
              rows={suppliers.data}
              columns={columns}
              getKey={(supplier) => supplier.id}
            />
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
          error={saveMutation.error ? toUserMessage(saveMutation.error) : undefined}
          pending={saveMutation.isPending}
          onCancel={closeForm}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
