"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createProductDtoSchema,
  type CreateProductDto,
  type ProductDto,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";

const blankProduct: CreateProductDto = {
  name: "",
  sku: null,
  category: "BEER",
  packName: "crate",
  unitsPerPack: 24,
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
  const form = useForm<CreateProductDto>({
    resolver: zodResolver(createProductDtoSchema),
    defaultValues: initialValues(product),
  });

  const values = initialValues(product);

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-5"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 sm:col-span-2">
          <span className="block text-sm font-medium">Product name</span>
          <input
            {...form.register("name")}
            className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            autoFocus
          />
          {form.formState.errors.name && (
            <span className="block text-sm text-destructive">
              {form.formState.errors.name.message}
            </span>
          )}
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium">Category</span>
          <select
            {...form.register("category")}
            className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          >
            <option value="BEER">Beer</option>
            <option value="SOFT_DRINK">Soft drink</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium">SKU (optional)</span>
          <Controller
            control={form.control}
            name="sku"
            render={({ field }) => (
              <input
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              />
            )}
          />
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium">Pack name</span>
          <input
            {...form.register("packName")}
            className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          />
          {form.formState.errors.packName && (
            <span className="block text-sm text-destructive">
              {form.formState.errors.packName.message}
            </span>
          )}
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium">Units per pack</span>
          <input
            type="number"
            min={1}
            step={1}
            {...form.register("unitsPerPack", { valueAsNumber: true })}
            className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          />
          {form.formState.errors.unitsPerPack && (
            <span className="block text-sm text-destructive">
              {form.formState.errors.unitsPerPack.message}
            </span>
          )}
        </label>
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
        {form.formState.errors.retailPriceKobo && (
          <p className="text-sm text-destructive">
            {form.formState.errors.retailPriceKobo.message}
          </p>
        )}
        {form.formState.errors.wholesalePriceKobo && (
          <p className="text-sm text-destructive">
            {form.formState.errors.wholesalePriceKobo.message}
          </p>
        )}
        <label className="space-y-1.5 sm:col-span-2">
          <span className="block text-sm font-medium">Reorder level (units)</span>
          <input
            type="number"
            min={0}
            step={1}
            {...form.register("reorderLevelUnits", { valueAsNumber: true })}
            className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          />
          {form.formState.errors.reorderLevelUnits && (
            <span className="block text-sm text-destructive">
              {form.formState.errors.reorderLevelUnits.message}
            </span>
          )}
        </label>
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
          {pending ? "Saving…" : product ? "Save changes" : "Add product"}
        </button>
      </div>
    </form>
  );
}
