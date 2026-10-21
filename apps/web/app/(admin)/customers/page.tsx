"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import {
  formatNaira,
  type CreateCustomerDto,
} from "@fabtyna/shared";
import type { CustomerFormDto, CustomerListItemDto } from "@/lib/api/customers.api";
import { CustomerForm } from "@/components/customers/customer-form";
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
import { customersApi } from "@/lib/api";
import {
  apiFieldErrors,
  toTechnicalDetail,
  toUserMessage,
} from "@/lib/api/client";
import { createIdempotencyIntent, type IdempotencyIntent } from "@/lib/api/idempotency-intent";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
import { useUIStore } from "@/stores/ui-store";

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.customersSearch);
  const showDeleted = useUIStore((state) => state.filters.customersShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);
  const [balanceFilter, setBalanceFilter] = useState<"all" | "with" | "without">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerFormDto>();
  const [loadingEdit, setLoadingEdit] = useState(false);
  const saveIntent = useRef(createIdempotencyIntent());
  const actionIntents = useRef(new Map<string, IdempotencyIntent>());

  const debouncedSearch = useDebouncedValue(search, 250);

  const customers = useInfiniteQuery({
    queryKey: queryKeys.customers.list(debouncedSearch, showDeleted, balanceFilter),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      return customersApi.listPage({
        search: debouncedSearch,
        includeDeleted: showDeleted,
        withBalance:
          balanceFilter === "all" ? undefined : balanceFilter === "with",
        cursor: pageParam,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const customerRows = (customers.data?.pages ?? []).flatMap((page) => page.items);

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
      key,
    }: {
      id?: string;
      input: CreateCustomerDto;
      key: string;
    }) => (id ? customersApi.update(id, input, key) : customersApi.create(input, key)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.customers.all,
      });
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
      action: "delete" | "restore";
      id: string;
      key: string;
    }) =>
      action === "delete"
        ? customersApi.softDelete(id, key)
        : customersApi.restore(id, key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingCustomer(undefined);
    saveMutation.reset();
    saveIntent.current.reset();
  }

  function openCreate() {
    setEditingCustomer(undefined);
    saveMutation.reset();
    saveIntent.current.reset();
    setFormOpen(true);
  }

  async function openEdit(customer: CustomerListItemDto) {
    setLoadingEdit(true);
    try {
      const detail = await customersApi.getById(customer.id);
      setEditingCustomer({ ...detail.customer, id: detail.customer.id });
      saveMutation.reset();
      saveIntent.current.reset();
      setFormOpen(true);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setLoadingEdit(false);
    }
  }

  async function save(input: CreateCustomerDto) {
    await saveMutation.mutateAsync({
      id: editingCustomer?.id,
      input,
      key: saveIntent.current.getKey(),
    });
  }

  async function deleteCustomer(customer: CustomerListItemDto) {
    // Business guard: a customer with an outstanding balance cannot be deleted.
    let balanceOwedKobo: string;
    try {
      const detail = await customersApi.getById(customer.id);
      balanceOwedKobo = detail.balanceOwedKobo;
    } catch (err) {
      toast.error(toUserMessage(err));
      return;
    }

    if (BigInt(balanceOwedKobo) > 0n) {
      toast.warning(
        `${customer.name} still owes ${formatNaira(balanceOwedKobo)}`,
        "Settle the outstanding balance before deleting this customer.",
      );
      return;
    }

    const ok = await confirm({
      title: `Deactivate ${customer.name}?`,
      description: "The customer will be hidden from active lists and can be reactivated later.",
      confirmLabel: "Deactivate customer",
      tone: "danger",
    });
    if (!ok) return;

    const intentId = `delete:${customer.id}`;
    let intent = actionIntents.current.get(intentId);
    if (!intent) {
      intent = createIdempotencyIntent();
      actionIntents.current.set(intentId, intent);
    }
    try {
      await actionMutation.mutateAsync({
        action: "delete",
        id: customer.id,
        key: intent.getKey(),
      });
      intent.markSucceeded();
      actionIntents.current.delete(intentId);
      toast.success(`${customer.name} deactivated`);
    } catch (err) {
      toast.error(toUserMessage(err));
    }
  }

  async function restoreCustomer(customer: CustomerListItemDto) {
    const ok = await confirm({
      title: `Reactivate ${customer.name}?`,
      description: "The customer will appear in active customer lists again.",
      confirmLabel: "Reactivate",
    });
    if (!ok) return;

    const intentId = `restore:${customer.id}`;
    let intent = actionIntents.current.get(intentId);
    if (!intent) {
      intent = createIdempotencyIntent();
      actionIntents.current.set(intentId, intent);
    }
    try {
      await actionMutation.mutateAsync({
        action: "restore",
        id: customer.id,
        key: intent.getKey(),
      });
      intent.markSucceeded();
      actionIntents.current.delete(intentId);
      toast.success(`${customer.name} reactivated`);
    } catch (err) {
      toast.error(toUserMessage(err));
    }
  }

  const columns: ResponsiveTableColumn<CustomerListItemDto>[] = [
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
      align: "right",
      render: (customer) => <Money kobo={customer.creditLimitKobo} />,
    },
    {
      header: "Balance owed",
      align: "right",
      render: (customer) => (
        <Money kobo={customer.balanceKobo ?? "0"} tone="auto" />
      ),
    },
    {
      header: "Phone",
      render: (customer) => customer.phone ?? "—",
    },
    {
      header: "Status",
      align: "center",
      render: (customer) => (
        <StatusBadge
          status={customer.active === false || customer.deletedAt ? "Inactive" : "Active"}
        />
      ),
    },
    {
      header: "Actions",
      align: "right",
      render: (customer) =>
        customer.active === false || customer.deletedAt ? (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void restoreCustomer(customer)}
            >
              Reactivate
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingEdit}
              onClick={() => void openEdit(customer)}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void deleteCustomer(customer)}
            >
              Deactivate
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Retail and wholesale customers with credit limits."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add customer
          </Button>
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1 sm:max-w-md">
              <span className="sr-only">Search customers</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) =>
                  setFilter("customersSearch", event.target.value)
                }
                placeholder="Search by name or phone..."
                className="pl-9"
              />
            </label>
            <label className="min-w-40 text-sm">
              <span className="sr-only">Filter by balance</span>
              <Select
                value={balanceFilter}
                onChange={(event) =>
                  setBalanceFilter(event.target.value as typeof balanceFilter)
                }
                aria-label="Filter customers by balance"
              >
                <option value="all">All balances</option>
                <option value="with">With balance</option>
                <option value="without">No balance</option>
              </Select>
            </label>
            <label className="inline-flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(event) =>
                  setFilter("customersShowDeleted", event.target.checked)
                }
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Show inactive customers
            </label>
          </div>

          {customers.isPending ? (
            <Skeleton variant="row" count={5} />
          ) : customers.isError ? (
            <ErrorState
              message={toUserMessage(customers.error)}
              detail={
                process.env.NODE_ENV === "development"
                  ? toTechnicalDetail(customers.error)
                  : undefined
              }
              onRetry={() => void customers.refetch()}
            />
          ) : customerRows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={showDeleted ? "No inactive customers" : "No customers yet"}
              description={
                showDeleted
                  ? "No inactive customers match this search."
                  : "Add a customer to track credit and sales."
              }
              action={
                showDeleted ? undefined : (
                  <Button onClick={openCreate}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add customer
                  </Button>
                )
              }
            />
          ) : (
            <ResponsiveTable
              rows={customerRows}
              columns={columns}
              getKey={(customer) => customer.id}
            />
          )}
          {customers.hasNextPage && (
            <div className="flex justify-center pt-3">
              <Button
                variant="secondary"
                disabled={customers.isFetchingNextPage}
                onClick={() => void customers.fetchNextPage()}
              >
                {customers.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingCustomer ? "Edit customer" : "Add customer"}
        size="lg"
        busy={saveMutation.isPending}
      >
        <CustomerForm
          key={editingCustomer?.id ?? "new-customer"}
          customer={editingCustomer}
          fieldErrors={apiFieldErrors(saveMutation.error)}
          error={
            saveMutation.error && Object.keys(apiFieldErrors(saveMutation.error)).length === 0
              ? toUserMessage(saveMutation.error)
              : undefined
          }
          pending={saveMutation.isPending}
          onCancel={closeForm}
          onEdit={() => saveIntent.current.reset()}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
