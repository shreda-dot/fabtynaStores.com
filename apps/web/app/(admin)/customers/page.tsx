"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { formatNaira, type CreateCustomerDto, type CustomerDto } from "@fabtyna/shared";
import { FormModal } from "@/components/form-modal";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/responsive-table";
import { CustomerForm } from "@/components/customers/customer-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { customersApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.customersSearch);
  const showDeleted = useUIStore((state) => state.filters.customersShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerDto>();

  const debouncedSearch = useDebouncedValue(search, 250);

  const customers = useQuery({
    queryKey: queryKeys.customers.list(debouncedSearch, showDeleted),
    queryFn: () =>
      customersApi.list({ search: debouncedSearch, includeDeleted: showDeleted }),
    placeholderData: keepPreviousData,
  });

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CreateCustomerDto;
    }) => (id ? customersApi.update(id, input) : customersApi.create(input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      closeForm();
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, id }: { action: "delete" | "restore"; id: string }) =>
      action === "delete" ? customersApi.softDelete(id) : customersApi.restore(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.customers.all }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingCustomer(undefined);
    saveMutation.reset();
  }

  function openCreate() {
    setEditingCustomer(undefined);
    saveMutation.reset();
    setFormOpen(true);
  }

  function openEdit(customer: CustomerDto) {
    setEditingCustomer(customer);
    saveMutation.reset();
    setFormOpen(true);
  }

  async function save(input: CreateCustomerDto) {
    await saveMutation.mutateAsync({ id: editingCustomer?.id, input });
  }

  function deleteCustomer(customer: CustomerDto) {
    if (
      !window.confirm(
        `Delete ${customer.name}? It will be hidden from lists and can be restored later.`,
      )
    ) {
      return;
    }
    actionMutation.mutate({ action: "delete", id: customer.id });
  }

  function restoreCustomer(customer: CustomerDto) {
    actionMutation.mutate({ action: "restore", id: customer.id });
  }

  const columns: ResponsiveTableColumn<CustomerDto>[] = [
    {
      header: "Customer",
      render: (customer) => (
        <Link
          href={`/customers/${customer.id}`}
          className="font-medium text-primary hover:underline"
        >
          {customer.name}
        </Link>
      ),
    },
    {
      header: "Type",
      render: (customer) => customer.type,
    },
    {
      header: "Credit limit",
      render: (customer) => formatNaira(customer.creditLimitKobo),
    },
    {
      header: "Phone",
      render: (customer) => customer.phone ?? "—",
    },
    {
      header: "Actions",
      render: (customer) =>
        customer.deletedAt ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => restoreCustomer(customer)}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Restore
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEdit(customer)}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => deleteCustomer(customer)}
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
            Customers
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Retail and wholesale customers with credit limits.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add customer
        </button>
      </div>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1 max-w-md">
            <span className="sr-only">Search customers</span>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setFilter("customersSearch", event.target.value)}
              placeholder="Search by name, phone or email..."
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label className="inline-flex h-9 items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) =>
                setFilter("customersShowDeleted", event.target.checked)
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

        {customers.isPending ? (
          <ListLoading />
        ) : customers.isError ? (
          <ListError
            message={customers.error.message || "Customers could not be loaded."}
            retry={() => void customers.refetch()}
          />
        ) : customers.data.length === 0 ? (
          <ListEmpty
            message={
              showDeleted
                ? "No deleted customers match this search."
                : "Add a customer to track credit and sales."
            }
          />
        ) : (
          <ResponsiveTable
            rows={customers.data}
            columns={columns}
            getKey={(customer) => customer.id}
          />
        )}
      </section>

      {formOpen && (
        <FormModal
          title={editingCustomer ? "Edit customer" : "Add customer"}
          onClose={closeForm}
        >
          <CustomerForm
            key={editingCustomer?.id ?? "new-customer"}
            customer={editingCustomer}
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
