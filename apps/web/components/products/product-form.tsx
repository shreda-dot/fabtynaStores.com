"use client";

import { useRef, useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createProductDtoSchema,
  type CreateProductDto,
  type ProductDto,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { useNetworkStatus } from "@/hooks/use-network-status";

const blankProduct: CreateProductDto = {
  name: "",
  sku: null,
  category: "BEER",
  packName: "crate",
  unitsPerPack: 24,
  saleChannel: "BOTH",
  retailPriceKobo: "",
  wholesalePriceKobo: "",
  reorderLevelUnits: 0,
};

function initialValues(product?: ProductDto): CreateProductDto {
  if (!product) return blankProduct;
  return {
    name: product.name,
    sku: product.sku,
    category: product.category,
    packName: product.packName,
    unitsPerPack: product.unitsPerPack,
    saleChannel: product.saleChannel,
    retailPriceKobo: product.retailPriceKobo,
    wholesalePriceKobo: product.wholesalePriceKobo,
    reorderLevelUnits: product.reorderLevelUnits,
  };
}

export function ProductForm({
  product,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  product?: ProductDto;
  error?: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: CreateProductDto) => Promise<void>;
}) {
  const network = useNetworkStatus();
  const submitting = useRef(false);
  const [summary, setSummary] = useState<string[]>([]);

  const form = useForm<CreateProductDto>({
    resolver: zodResolver(createProductDtoSchema),
    defaultValues: initialValues(product),
    mode: "onBlur",
  });

  const values = initialValues(product);
  const errors = form.formState.errors;

  async function handleValid(input: CreateProductDto) {
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
    if (firstKey) form.setFocus(firstKey as keyof CreateProductDto);
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    // `handleSubmit` reads the submit ref through `handleValid`, so it must be
    // created inside the event handler rather than during render.
    void form.handleSubmit(handleValid, handleInvalid)(event);
  }

  return (
    <form onSubmit={submitForm} className="space-y-5" noValidate>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="product-name"
          label="Product name"
          className="sm:col-span-2"
          error={errors.name?.message}
        >
          <Input
            id="product-name"
            autoFocus
            aria-invalid={errors.name !== undefined}
            {...form.register("name")}
          />
        </FormField>

        <FormField
          id="product-category"
          label="Category"
          error={errors.category?.message}
        >
          <Select id="product-category" {...form.register("category")}>
            <option value="BEER">Beer</option>
            <option value="SOFT_DRINK">Soft drink</option>
            <option value="OTHER">Other</option>
          </Select>
        </FormField>

        <FormField
          id="product-channel"
          label="Sale channel"
          error={errors.saleChannel?.message}
        >
          <Select id="product-channel" {...form.register("saleChannel")}>
            <option value="BOTH">Both (retail &amp; wholesale)</option>
            <option value="RETAIL">Retail only (fridge)</option>
            <option value="WHOLESALE">Wholesale only</option>
          </Select>
        </FormField>

        <FormField
          id="product-sku"
          label="SKU (optional)"
          error={errors.sku?.message}
        >
          <Controller
            control={form.control}
            name="sku"
            render={({ field }) => (
              <Input
                id="product-sku"
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
          id="product-pack-name"
          label="Pack name"
          error={errors.packName?.message}
        >
          <Input
            id="product-pack-name"
            aria-invalid={errors.packName !== undefined}
            {...form.register("packName")}
          />
        </FormField>

        <FormField
          id="product-units-per-pack"
          label="Units per pack"
          error={errors.unitsPerPack?.message}
        >
          <Input
            id="product-units-per-pack"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            aria-invalid={errors.unitsPerPack !== undefined}
            {...form.register("unitsPerPack", { valueAsNumber: true })}
          />
        </FormField>

        <div className="space-y-1.5">
          <MoneyInput
            id="retail-price"
            label="Retail price per unit"
            defaultValueKobo={values.retailPriceKobo}
            onKoboChange={(amount) =>
              form.setValue("retailPriceKobo", amount, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
          {errors.retailPriceKobo && (
            <p role="alert" className="text-sm text-danger">
              {errors.retailPriceKobo.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <MoneyInput
            id="wholesale-price"
            label="Wholesale price per crate"
            defaultValueKobo={values.wholesalePriceKobo}
            onKoboChange={(amount) =>
              form.setValue("wholesalePriceKobo", amount, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
          {errors.wholesalePriceKobo && (
            <p role="alert" className="text-sm text-danger">
              {errors.wholesalePriceKobo.message}
            </p>
          )}
        </div>

        <FormField
          id="product-reorder"
          label="Reorder level (units)"
          className="sm:col-span-2"
          error={errors.reorderLevelUnits?.message}
        >
          <Input
            id="product-reorder"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            aria-invalid={errors.reorderLevelUnits !== undefined}
            {...form.register("reorderLevelUnits", { valueAsNumber: true })}
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
          {product ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}
