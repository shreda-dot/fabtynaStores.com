"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCustomerDtoSchema,
  type CreateCustomerDto,
  type CustomerDto,
  type CustomerType,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";

function initialValues(customer?: CustomerDto): CreateCustomerDto {
  return {
    name: customer?.name ?? "",
    type: (customer?.type as CustomerType) ?? "RETAIL",
    creditLimitKobo: customer?.creditLimitKobo ?? "0",
    phone: customer?.phone ?? null,
    email: customer?.email ?? null,
    address: customer?.address ?? null,
    notes: customer?.notes ?? null,
  };
}

export function CustomerForm({
  customer,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  customer?: CustomerDto;
  error?: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: CreateCustomerDto) => Promise<void>;
}) {
  const form = useForm<CreateCustomerDto>({
    resolver: zodResolver(createCustomerDtoSchema),
    defaultValues: initialValues(customer),
  });

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-5"
      noValidate
    >
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Customer name</span>
        <input
          {...form.register("name")}
          autoFocus
          className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
        />
        {form.formState.errors.name && (
          <span className="block text-sm text-destructive">
            {form.formState.errors.name.message}
          </span>
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Type</span>
          <select
            {...form.register("type")}
            className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          >
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
          </select>
        </label>

        <Controller
          control={form.control}
          name="creditLimitKobo"
          render={({ field }) => (
            <MoneyInput
              id="credit-limit"
              label="Credit limit"
              defaultValueKobo={field.value}
              onKoboChange={(value) => field.onChange(value)}
            />
          )}
        />
        <Controller
          control={form.control}
          name="phone"
          render={({ field }) => (
            <label className="space-y-1.5">
              <span className="block text-sm font-medium">Phone</span>
              <input
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            </label>
          )}
        />
        <Controller
          control={form.control}
          name="email"
          render={({ field }) => (
            <label className="space-y-1.5">
              <span className="block text-sm font-medium">Email</span>
              <input
                ref={field.ref}
                type="email"
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
              {form.formState.errors.email && (
                <span className="block text-sm text-destructive">
                  {form.formState.errors.email.message}
                </span>
              )}
            </label>
          )}
        />
        <Controller
          control={form.control}
          name="address"
          render={({ field }) => (
            <label className="space-y-1.5 sm:col-span-2">
              <span className="block text-sm font-medium">Address</span>
              <textarea
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
              />
            </label>
          )}
        />
        <Controller
          control={form.control}
          name="notes"
          render={({ field }) => (
            <label className="space-y-1.5 sm:col-span-2">
              <span className="block text-sm font-medium">Notes</span>
              <textarea
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
              />
            </label>
          )}
        />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Saving…" : customer ? "Save changes" : "Add customer"}
        </button>
      </div>
    </form>
  );
}
