"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { formatNaira, parseMoneyInputToKobo } from "@fabtyna/shared";
import { QuickAddCustomerDialog } from "@/components/customers/quick-add-customer-dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { customersApi, productsApi, salesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/stores/toast-store";

/**
 * Converts what the user typed in naira ("1,200" or "1200.50") into a kobo
 * string. Returns null for anything empty, invalid or not greater than zero.
 * Never treats the typed number as kobo.
 */
function nairaInputToKobo(raw: string): string | null {
  if (raw.trim() === "") return null;
  try {
    const kobo = parseMoneyInputToKobo(raw);
    if (!kobo || !/^[0-9]+$/.test(String(kobo))) return null;
    return BigInt(kobo) > 0n ? String(kobo) : null;
  } catch {
    return null;
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
};

type DebtorInput = {
  customerId: string;
  productId: string;
  quantity: number;
  unitPriceKobo: string;
};

export function RecordDebtorDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const submitting = useRef(false);

  const [customerId, setCustomerId] = useState("");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");

  const customers = useQuery({
    queryKey: queryKeys.customers.list("", false),
    queryFn: () => customersApi.list({ search: "", includeDeleted: false }),
    enabled: open,
  });

  const products = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
    enabled: open,
  });

  const retailCustomers = useMemo(() => {
    return (customers.data ?? []).filter((c) => c.type === "RETAIL");
  }, [customers.data]);

  const mutation = useMutation({
    mutationFn: (input: DebtorInput) =>
      salesApi.create({
        customerId: input.customerId,
        customerName: null,
        channel: "RETAIL",
        location: "RETAIL_SHELF",
        soldAt: new Date().toISOString(),
        notes: null,
        reference: null,
        paidKobo: "0",
        lines: [
          {
            productId: input.productId,
            unit: "UNIT",
            quantity: input.quantity,
            unitPriceKobo: input.unitPriceKobo,
          },
        ],
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.customers.all,
      });
      const total = BigInt(input.unitPriceKobo) * BigInt(input.quantity);
      const name =
        retailCustomers.find((c) => c.id === input.customerId)?.name ??
        "customer";
      toast.success(`Debt of ${formatNaira(total)} recorded for ${name}.`);
      close();
    },
    onError: (err) => {
      setError(toUserMessage(err));
      toast.error(toUserMessage(err));
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  function resetForm() {
    setCustomerId("");
    setProductId("");
    setQty("");
    setPrice("");
    setError("");
    submitting.current = false;
  }

  function close() {
    setAddingCustomer(false);
    resetForm();
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || mutation.isPending) return;
    setError("");

    if (customerId === "") {
      setError("Select the customer, or add a new one.");
      return;
    }
    if (productId === "") {
      setError("Select a product.");
      return;
    }
    const quantity = Number(qty);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }
    const unitPriceKobo = nairaInputToKobo(price);
    if (unitPriceKobo === null) {
      setError(
        "Enter a unit price in naira greater than zero, e.g. 1200 or 1,200.50.",
      );
      return;
    }

    submitting.current = true;
    mutation.mutate({ customerId, productId, quantity, unitPriceKobo });
  }

  // Live total so the amount that will be owed is visible before saving.
  const previewKobo = nairaInputToKobo(price);
  const previewQty = Number(qty);
  const previewTotal =
    previewKobo !== null && Number.isInteger(previewQty) && previewQty > 0
      ? BigInt(previewKobo) * BigInt(previewQty)
      : null;

  const networkBusy = mutation.isPending;

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Record retail debtor"
        description="A retail sale with nothing paid yet. Stock leaves the fridge and the full amount is owed."
        size="sm"
        busy={networkBusy}
        closeOnEsc={!addingCustomer}
        closeOnOverlay={!addingCustomer}
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormField id="debtor-customer" label="Customer">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  id="debtor-customer"
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                >
                  <option value="">Select customer</option>
                  {retailCustomers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={networkBusy}
                onClick={() => setAddingCustomer(true)}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add
              </Button>
            </div>
            {!customers.isPending && retailCustomers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No retail customers yet — use Add to create one.
              </p>
            )}
          </FormField>

          <FormField id="debtor-product" label="Product">
            <Select
              id="debtor-product"
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              <option value="">
                {products.isPending ? "Loading products…" : "Select product"}
              </option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField id="debtor-qty" label="Quantity (units)">
              <Input
                id="debtor-qty"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 6"
              />
            </FormField>
            <FormField id="debtor-price" label="Unit price (₦)">
              <Input
                id="debtor-price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 1,200"
                autoComplete="off"
              />
            </FormField>
          </div>

          {previewTotal !== null && (
            <p className="text-sm text-muted-foreground">
              Total owed:{" "}
              <span className="tabular font-semibold text-foreground">
                {formatNaira(previewTotal)}
              </span>
            </p>
          )}

          {error !== "" && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={networkBusy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Record debtor
            </Button>
          </div>
        </form>
      </Modal>

      <QuickAddCustomerDialog
        open={addingCustomer}
        defaultType="RETAIL"
        onClose={() => setAddingCustomer(false)}
        onCreated={(customer) => setCustomerId(customer.id)}
      />
    </>
  );
}
