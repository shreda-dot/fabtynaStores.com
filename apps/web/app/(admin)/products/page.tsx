"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { formatNaira, type CreateProductDto, type ProductDto } from "@fabtyna/shared";
import { FormModal } from "@/components/form-modal";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { ProductForm } from "@/components/products/product-form";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { productsApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";

function categoryLabel(category: ProductDto["category"]): string {
  if (category === "SOFT_DRINK") return "Soft drink";
  if (category === "BEER") return "Beer";
  return "Other";
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.productsSearch);
  const showDeleted = useUIStore((state) => state.filters.productsShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);
  const activeModal = useUIStore((state) => state.activeModal);
  const setActiveModal = useUIStore((state) => state.setActiveModal);
  const [editingProduct, setEditingProduct] = useState<ProductDto>();

  const products = useQuery({
    queryKey: queryKeys.products.list(search, showDeleted),
    queryFn: () => productsApi.list({ search, includeDeleted: showDeleted }),
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
    setActiveModal(null);
    setEditingProduct(undefined);
    saveMutation.reset();
  }

  function openCreate() {
    setEditingProduct(undefined);
    saveMutation.reset();
    setActiveModal("product");
  }

  function openEdit(product: ProductDto) {
    setEditingProduct(product);
    saveMutation.reset();
    setActiveModal("product");
  }

  async function save(input: CreateProductDto) {
    await saveMutation.mutateAsync({ id: editingProduct?.id, input });
  }

  function deleteProduct(product: ProductDto) {
    if (!window.confirm(`Soft-delete ${product.name}? It can be restored later.`)) return;
    actionMutation.mutate({ action: "delete", id: product.id });
  }

  function restoreProduct(product: ProductDto) {
    actionMutation.mutate({ action: "restore", id: product.id });
  }

  const columns: ResponsiveTableColumn<ProductDto>[] = [
    {
      header: "Product",
      render: (product) => (
        <div>
          <p className="font-medium">{product.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {product.sku ?? "No SKU"} · {categoryLabel(product.category)}
          </p>
        </div>
      ),
    },
    {
      header: "Retail / unit",
      render: (product) => formatNaira(product.retailPriceKobo),
    },
    {
      header: "Wholesale / crate",
      render: (product) => formatNaira(product.wholesalePriceKobo),
    },
    {
      header: "Pack & reorder",
      render: (product) =>
        `${product.unitsPerPack} units / ${product.packName}; reorder at ${product.reorderLevelUnits}`,
    },
    {
      header: "Actions",
      render: (product) =>
        product.deletedAt ? (
          <button
            type="button"
            disabled={actionMutation.isPending}
            onClick={() => restoreProduct(product)}
            className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            Restore
          </button>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => openEdit(product)}
              className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={actionMutation.isPending}
              onClick={() => deleteProduct(product)}
              className="min-h-11 rounded-md border border-border px-3 text-sm font-medium text-destructive hover:bg-muted disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Maintain products, pack sizes and selling prices.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add product
        </button>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search products</span>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setFilter("productsSearch", event.target.value)}
              placeholder="Search by name or SKU"
              className="min-h-12 w-full rounded-md border border-input bg-background pl-10 pr-3 text-base"
            />
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) =>
                setFilter("productsShowDeleted", event.target.checked)
              }
              className="h-4 w-4 accent-primary"
            />
            Show deleted
          </label>
        </div>

        {actionMutation.error && (
          <p role="alert" className="text-sm text-destructive">
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

      {activeModal === "product" && (
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
