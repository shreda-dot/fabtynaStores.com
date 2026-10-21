"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createSupplierDtoSchema,
  type CreateSupplierDto,
} from "@fabtyna/shared";
import type { SupplierFormDto } from "@/lib/api/suppliers.api";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { useNetworkStatus } from "@/hooks/use-network-status";

function initialValues(supplier?: SupplierFormDto): CreateSupplierDto {
  return {
    name: supplier?.name ?? "",
    phone: supplier?.phone ?? null,
    email: supplier?.email ?? null,
    address: supplier?.address ?? null,
    notes: supplier?.notes ?? null,
  };
}

export function SupplierForm({
  supplier,
  fieldErrors,
  error,
  pending,
  onCancel,
  onEdit,
  onSubmit,
}: {
  supplier?: SupplierFormDto;
  fieldErrors?: Record<string, string>;
  error?: string;
  pending: boolean;
  onCancel: () => void;
  onEdit?: () => void;
  onSubmit: (value: CreateSupplierDto) => Promise<void>;
}) {
  const network = useNetworkStatus();
  const submitting = useRef(false);
  const [summary, setSummary] = useState<string[]>([]);

  const form = useForm<CreateSupplierDto>({
    resolver: zodResolver(createSupplierDtoSchema),
    defaultValues: initialValues(supplier),
    mode: "onBlur",
  });

  const errors = form.formState.errors;

  useEffect(() => {
    for (const [name, message] of Object.entries(fieldErrors ?? {})) {
      if (name in form.getValues()) {
        form.setError(name as keyof CreateSupplierDto, {
          type: "server",
          message,
        });
      }
    }
  }, [fieldErrors, form]);

  async function handleValid(input: CreateSupplierDto) {
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
    if (firstKey) form.setFocus(firstKey as keyof CreateSupplierDto);
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
        id="supplier-name"
        label="Supplier name"
        error={errors.name?.message}
      >
        <Input
          id="supplier-name"
          autoFocus
          aria-invalid={errors.name !== undefined}
          {...form.register("name")}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="supplier-phone"
          label="Phone"
          error={errors.phone?.message}
        >
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <Input
                id="supplier-phone"
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
          id="supplier-email"
          label="Email"
          error={errors.email?.message}
        >
          <Controller
            control={form.control}
            name="email"
            render={({ field }) => (
              <Input
                id="supplier-email"
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
          id="supplier-address"
          label="Address"
          className="sm:col-span-2"
          error={errors.address?.message}
        >
          <Controller
            control={form.control}
            name="address"
            render={({ field }) => (
              <Textarea
                id="supplier-address"
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
          id="supplier-notes"
          label="Notes"
          className="sm:col-span-2"
          error={errors.notes?.message}
        >
          <Controller
            control={form.control}
            name="notes"
            render={({ field }) => (
              <Textarea
                id="supplier-notes"
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
          {supplier ? "Save changes" : "Add supplier"}
        </Button>
      </div>
    </form>
  );
}
