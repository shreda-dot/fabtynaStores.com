"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createSupplierDtoSchema,
  type CreateSupplierDto,
  type SupplierDto,
} from "@fabtyna/shared";

function initialValues(supplier?: SupplierDto): CreateSupplierDto {
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
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  supplier?: SupplierDto;
  error?: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: CreateSupplierDto) => Promise<void>;
}) {
  const form = useForm<CreateSupplierDto>({
    resolver: zodResolver(createSupplierDtoSchema),
    defaultValues: initialValues(supplier),
  });

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-5"
      noValidate
    >
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Supplier name</span>
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
          {pending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
        </button>
      </div>
    </form>
  );
}
