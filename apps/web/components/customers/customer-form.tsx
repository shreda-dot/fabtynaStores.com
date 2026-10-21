"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCustomerDtoSchema,
  type CreateCustomerDto,
  type CustomerType,
} from "@fabtyna/shared";
import type { CustomerFormDto } from "@/lib/api/customers.api";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useNetworkStatus } from "@/hooks/use-network-status";

function initialValues(
  customer: CustomerFormDto | undefined,
  defaultType: CustomerType,
): CreateCustomerDto {
  return {
    name: customer?.name ?? "",
    type: (customer?.type as CustomerType) ?? defaultType,
    creditLimitKobo: customer?.creditLimitKobo ?? "0",
    phone: customer?.phone ?? null,
    email: customer?.email ?? null,
    address: customer?.address ?? null,
    notes: customer?.notes ?? null,
  };
}

export function CustomerForm({
  customer,
  fieldErrors,
  defaultType = "RETAIL",
  error,
  pending,
  onCancel,
  onEdit,
  onSubmit,
}: {
  customer?: CustomerFormDto;
  fieldErrors?: Record<string, string>;
  /** Type pre-selected when adding a brand-new customer. */
  defaultType?: CustomerType;
  error?: string;
  pending: boolean;
  onCancel: () => void;
  onEdit?: () => void;
  onSubmit: (value: CreateCustomerDto) => Promise<void>;
}) {
  const network = useNetworkStatus();
  const submitting = useRef(false);
  const [summary, setSummary] = useState<string[]>([]);

  const form = useForm<CreateCustomerDto>({
    resolver: zodResolver(createCustomerDtoSchema),
    defaultValues: initialValues(customer, defaultType),
    mode: "onBlur",
  });

  const errors = form.formState.errors;

  useEffect(() => {
    for (const [name, message] of Object.entries(fieldErrors ?? {})) {
      if (name in form.getValues()) {
        form.setError(name as keyof CreateCustomerDto, {
          type: "server",
          message,
        });
      }
    }
  }, [fieldErrors, form]);

  async function handleValid(input: CreateCustomerDto) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await onSubmit(input);
    } finally {
      submitting.current = false;
    }
  }

  function handleInvalid(formErrors: typeof errors) {
    const messages = Object.values(formErrors)
      .map((fieldError) => fieldError?.message)
      .filter((message): message is string => typeof message === "string");
    setSummary(messages);
    const firstKey = Object.keys(formErrors)[0];
    if (firstKey) form.setFocus(firstKey as keyof CreateCustomerDto);
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    // `handleSubmit` reads the submit ref through `handleValid`, so it must be
    // created inside the event handler rather than during render.
    void form.handleSubmit(handleValid, handleInvalid)(event);
  }

  return (
    <form
      onSubmit={submitForm}
      onChange={() => {
        form.clearErrors();
        onEdit?.();
      }}
      className="space-y-5"
      noValidate
    >
      {summary.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger"
        >
          <p className="font-medium">
            {summary.length === 1
              ? "There is 1 problem to fix"
              : `There are ${summary.length} problems to fix`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {summary.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <FormField
        id="customer-name"
        label="Customer name"
        error={errors.name?.message}
      >
        <Input
          id="customer-name"
          autoFocus
          aria-invalid={errors.name !== undefined}
          {...form.register("name")}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="customer-type" label="Type" error={errors.type?.message}>
          <Select id="customer-type" {...form.register("type")}>
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
          </Select>
        </FormField>

        <div className="space-y-1.5">
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
          {errors.creditLimitKobo && (
            <p role="alert" className="text-sm text-danger">
              {errors.creditLimitKobo.message}
            </p>
          )}
        </div>

        <FormField
          id="customer-phone"
          label="Phone"
          error={errors.phone?.message}
        >
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <Input
                id="customer-phone"
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
              />
            )}
          />
        </FormField>

        <FormField
          id="customer-email"
          label="Email"
          error={errors.email?.message}
        >
          <Controller
            control={form.control}
            name="email"
            render={({ field }) => (
              <Input
                id="customer-email"
                ref={field.ref}
                type="email"
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
              />
            )}
          />
        </FormField>

        <FormField
          id="customer-address"
          label="Address"
          className="sm:col-span-2"
          error={errors.address?.message}
        >
          <Controller
            control={form.control}
            name="address"
            render={({ field }) => (
              <Textarea
                id="customer-address"
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                rows={2}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
              />
            )}
          />
        </FormField>

        <FormField
          id="customer-notes"
          label="Notes"
          className="sm:col-span-2"
          error={errors.notes?.message}
        >
          <Controller
            control={form.control}
            name="notes"
            render={({ field }) => (
              <Textarea
                id="customer-notes"
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                rows={3}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
              />
            )}
          />
        </FormField>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {network.offline && (
        <p className="text-sm text-warning">
          You&rsquo;re offline. Changes can&rsquo;t be saved until you
          reconnect.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={network.offline}>
          {customer ? "Save changes" : "Add customer"}
        </Button>
      </div>
    </form>
  );
}
