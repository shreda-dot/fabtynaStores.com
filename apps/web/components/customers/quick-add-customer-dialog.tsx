"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateCustomerDto,
  CustomerDto,
  CustomerType,
} from "@fabtyna/shared";
import { CustomerForm } from "@/components/customers/customer-form";
import { Modal } from "@/components/ui/modal";
import { customersApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/stores/toast-store";

/**
 * Creates a customer without leaving the current screen (e.g. a sale form), so
 * a debt is always attached to a real customer record instead of a typed name.
 * The new customer is handed back through `onCreated` for immediate selection.
 */
export function QuickAddCustomerDialog({
  open,
  defaultType,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultType: CustomerType;
  onCreated: (customer: CustomerDto) => void;
}) {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: CreateCustomerDto) => customersApi.create(input),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      toast.success(`${customer.name} added.`);
      onCreated(customer);
      onClose();
    },
    onError: (err) => toast.error(toUserMessage(err)),
  });

  async function save(input: CreateCustomerDto) {
    await createMutation.mutateAsync(input);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add customer"
      description="Saved to the Customers page so this person is never recorded twice."
      size="md"
      busy={createMutation.isPending}
    >
      <CustomerForm
        defaultType={defaultType}
        error={
          createMutation.isError
            ? toUserMessage(createMutation.error)
            : undefined
        }
        pending={createMutation.isPending}
        onCancel={onClose}
        onSubmit={save}
      />
    </Modal>
  );
}
