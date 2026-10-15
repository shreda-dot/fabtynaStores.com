"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { formatNaira, type CreateProductDto, type ProductDto } from "@fabtyna/shared";
import { FormModal } from "@/components/form-modal";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { ProductForm } from "@/components/products/product-form";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { productsApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";

function categoryLabel(category: ProductDto["category"]): string {
  if (category === "SOFT_DRINK") return "Soft drink";
  if (category === "BEER") return "Beer";
  return "Other";
}

function channelLabel(channel: ProductDto["saleChannel"]): string {
  if (channel === "RETAIL") return "Retail (fridge)";
  if (channel === "WHOLESALE") return "Wholesale";
  return "Both";
}

function channelBadgeClass(channel: ProductDto["saleChannel"]): string {
  const base =
    "mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium";
  if (channel === "RETAIL") return `${base} bg-blue-500/15 text-blue-700 dark:text-blue-300`;
  if (channel === "WHOLESALE") return `${base} bg-amber-500/15 text-amber-700 dark:text-amber-300`;
  return `${base} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`;
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.productsSearch);
  const showDeleted = useUIStore((state) => state.filters.productsShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);

  // Modal state is local to this page so it can never reopen by itself after
  // navigating away and back (the global store outlives the page).
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDto>();

  // The input updates immediately; the query waits until typing pauses, and the
  // previous list stays on screen while the new one loads (no skeleton flash).
  const debouncedSearch = useDebouncedValue(search, 250);

  const products = useQuery({
    queryKey: queryKeys.products.list(debouncedSearch, showDeleted),
    queryFn: () =>
      productsApi.list({ search: debouncedSearch, includeDeleted: showDeleted }),
    placeholderData: keepPreviousData,
  });

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CreateProductDto;
    }) => (id ? productsApi.update(id, input) : productsApi.create(input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      closeForm();
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, id }: { action: "delete" | "restore"; id: string }) =>
      action === "delete" ? productsApi.softDelete(id) : productsApi.restore(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingProduct(undefined);
    saveMutation.reset();
  }

  function openCreate() {
    setEditingProduct(undefined);
    saveMutation.reset();
    setFormOpen(true);
  }

  function openEdit(product: ProductDto) {
    setEditingProduct(product);
    saveMutation.reset();
    setFormOpen(true);
  }

  async function save(input: CreateProductDto) {
    await saveMutation.mutateAsync({ id: editingProduct?.id, input });
  }

  function deleteProduct(product: ProductDto) {
    if (
      !window.confirm(
        `Delete ${product.name}? It will be hidden from lists and can be restored later.`,
      )
    ) {
      return;
    }
    actionMutation.mutate({ action: "delete", id: product.id });
  }

  function restoreProduct(product: ProductDto) {
    actionMutation.mutate({ action: "restore", id: product.id });
  }

  const columns: ResponsiveTableColumn<ProductDto>[] = [
    {
      header: "Product",
      render: (product) => (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{product.name}</p>
          <p className="text-xs text-muted-foreground">
            {product.sku ?? "No SKU"} · {categoryLabel(product.category)}
          </p>
          <span className={channelBadgeClass(product.saleChannel)}>
            {channelLabel(product.saleChannel)}
          </span>
        </div>
      ),
    },
    {
      header: "Retail price",
      render: (product) => (
        <span className="text-sm text-muted-foreground">
          {formatNaira(product.retailPriceKobo)} / unit
        </span>
      ),
    },
    {
      header: "Wholesale price",
      render: (product) => (
        <span className="text-sm text-muted-foreground">
          {formatNaira(product.wholesalePriceKobo)} / {product.packName}
        </span>
      ),
    },
    {
      header: "Pack & reorder",
      render: (product) => (
        <span className="text-sm text-muted-foreground">
          {product.unitsPerPack} units / {product.packName}; reorder at {product.reorderLevelUnits} units
        </span>
      ),
    },
    {
      header: "Actions",
      render: (product) =>
        product.deletedAt ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => restoreProduct(product)}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Restore
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEdit(product)}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => deleteProduct(product)}
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
            Products
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Maintain products, pack sizes and selling prices.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add product
        </button>
      </div>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1 max-w-md">
            <span className="sr-only">Search products</span>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setFilter("productsSearch", event.target.value)}
              placeholder="Search by name or SKU..."
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label className="inline-flex h-9 items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) =>
                setFilter("productsShowDeleted", event.target.checked)
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

        {products.isPending ? (
          <ListLoading />
        ) : products.isError ? (
          <ListError
            message={products.error.message || "Products could not be loaded."}
            retry={() => void products.refetch()}
          />
        ) : products.data.length === 0 ? (
          <ListEmpty
            message={
              showDeleted
                ? "No deleted products match this search."
                : "Add a product to start setting up the catalogue."
            }
          />
        ) : (
          <ResponsiveTable
            rows={products.data}
            columns={columns}
            getKey={(product) => product.id}
          />
        )}
      </section>

      {formOpen && (
        <FormModal
          title={editingProduct ? "Edit product" : "Add product"}
          onClose={closeForm}
        >
          <ProductForm
            key={editingProduct?.id ?? "new-product"}
            product={editingProduct}
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