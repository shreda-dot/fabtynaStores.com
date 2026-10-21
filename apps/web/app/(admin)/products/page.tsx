"use client";

import { useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Package, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { CreateProductDto } from "@fabtyna/shared";
import type {
  ProductFormDto,
  ProductRecordDto,
} from "@/lib/api/products.api";
import { ProductForm } from "@/components/products/product-form";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Badge, StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { productsApi } from "@/lib/api";
import {
  apiFieldErrors,
  toTechnicalDetail,
  toUserMessage,
} from "@/lib/api/client";
import { createIdempotencyIntent, type IdempotencyIntent } from "@/lib/api/idempotency-intent";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
import { useUIStore } from "@/stores/ui-store";

function categoryLabel(category: ProductRecordDto["category"]): string {
  if (category === "SOFT_DRINK") return "Soft drink";
  if (category === "BEER") return "Beer";
  return "Other";
}

function channelLabel(channel: ProductRecordDto["saleChannel"]): string {
  if (channel === "RETAIL") return "Retail (fridge)";
  if (channel === "WHOLESALE") return "Wholesale";
  return "Both";
}

const CHANNEL_TONE: Record<ProductRecordDto["saleChannel"], BadgeTone> = {
  RETAIL: "info",
  WHOLESALE: "accent",
  BOTH: "success",
};

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const search = useUIStore((state) => state.filters.productsSearch);
  const showDeleted = useUIStore((state) => state.filters.productsShowDeleted);
  const setFilter = useUIStore((state) => state.setFilter);

  // Modal state is local to this page so it can never reopen by itself after
  // navigating away and back (the global store outlives the page).
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<(ProductFormDto & { hasStockMovement?: boolean })>();
  const [loadingEdit, setLoadingEdit] = useState(false);
  const saveIntent = useRef(createIdempotencyIntent());
  const actionIntents = useRef(new Map<string, IdempotencyIntent>());

  // The input updates immediately; the query waits until typing pauses, and the
  // previous list stays on screen while the new one loads (no skeleton flash).
  const debouncedSearch = useDebouncedValue(search, 250);

  const products = useInfiniteQuery({
    queryKey: queryKeys.products.pages(debouncedSearch, showDeleted),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      return productsApi.listPage({
        search: debouncedSearch,
        includeDeleted: showDeleted,
        cursor: pageParam,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const productRows = (products.data?.pages ?? []).flatMap((page) => page.items);

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
      key,
    }: {
      id?: string;
      input: CreateProductDto;
      key: string;
    }) => (id ? productsApi.update(id, input, key) : productsApi.create(input, key)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      saveIntent.current.markSucceeded();
      closeForm();
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({
      action,
      id,
      key,
    }: {
      action: "delete" | "restore";
      id: string;
      key: string;
    }) =>
      action === "delete"
        ? productsApi.softDelete(id, key)
        : productsApi.restore(id, key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingProduct(undefined);
    saveMutation.reset();
    saveIntent.current.reset();
  }

  function openCreate() {
    setEditingProduct(undefined);
    saveMutation.reset();
    saveIntent.current.reset();
    setFormOpen(true);
  }

  async function openEdit(product: ProductRecordDto) {
    setLoadingEdit(true);
    try {
      const detail = await productsApi.getById(product.id);
      setEditingProduct(detail);
      saveMutation.reset();
      saveIntent.current.reset();
      setFormOpen(true);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setLoadingEdit(false);
    }
  }

  async function save(input: CreateProductDto) {
    await saveMutation.mutateAsync({
      id: editingProduct?.id,
      input,
      key: saveIntent.current.getKey(),
    });
  }

  async function runAction(action: "delete" | "restore", product: ProductRecordDto) {
    const isDelete = action === "delete";
    const ok = await confirm({
      title: isDelete ? `Deactivate ${product.name}?` : `Reactivate ${product.name}?`,
      description: isDelete
        ? "The product will be hidden from active lists and can be reactivated later."
        : "The product will appear in active product lists again.",
      confirmLabel: isDelete ? "Deactivate product" : "Reactivate",
      tone: isDelete ? "danger" : "normal",
    });
    if (!ok) return;
    const intentId = `${action}:${product.id}`;
    let intent = actionIntents.current.get(intentId);
    if (!intent) {
      intent = createIdempotencyIntent();
      actionIntents.current.set(intentId, intent);
    }
    try {
      await actionMutation.mutateAsync({
        action,
        id: product.id,
        key: intent.getKey(),
      });
      intent.markSucceeded();
      actionIntents.current.delete(intentId);
      toast.success(isDelete ? `${product.name} deactivated` : `${product.name} reactivated`);
    } catch (err) {
      toast.error(toUserMessage(err));
    }
  }

  const columns: ResponsiveTableColumn<ProductRecordDto>[] = [
    {
      header: "Product",
      render: (product) => (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">
            <Link href={`/products/${product.id}`} className="hover:text-primary hover:underline">
              {product.name}
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">
            {product.sku ?? "No SKU"} · {categoryLabel(product.category)}
          </p>
          <Badge tone={CHANNEL_TONE[product.saleChannel]} className="mt-0.5">
            {channelLabel(product.saleChannel)}
          </Badge>
        </div>
      ),
    },
    {
      header: "Retail price",
      align: "right",
      render: (product) => (
        <span className="text-sm text-muted-foreground">
          <Money kobo={product.retailPriceKobo} /> / unit
        </span>
      ),
    },
    {
      header: "Wholesale price",
      align: "right",
      render: (product) => (
        <span className="text-sm text-muted-foreground">
          <Money kobo={product.wholesalePriceKobo} /> / {product.packName}
        </span>
      ),
    },
    {
      header: "Pack & reorder",
      render: (product) => (
        <span className="text-sm text-muted-foreground">
          {product.unitsPerPack} units / {product.packName}; reorder at{" "}
          {product.reorderLevelUnits} units
        </span>
      ),
    },
    {
      header: "Status",
      align: "center",
      render: (product) => (
        <StatusBadge
          status={product.active === false || product.deletedAt ? "Inactive" : "Active"}
        />
      ),
    },
    {
      header: "Actions",
      align: "right",
      render: (product) =>
        product.active === false || product.deletedAt ? (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void runAction("restore", product)}
            >
              Reactivate
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingEdit}
              onClick={() => void openEdit(product)}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => void runAction("delete", product)}
            >
              Deactivate
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Maintain products, pack sizes and selling prices."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add product
          </Button>
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1 sm:max-w-md">
              <span className="sr-only">Search products</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setFilter("productsSearch", event.target.value)}
                placeholder="Search by name or SKU..."
                className="pl-9"
              />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(event) =>
                  setFilter("productsShowDeleted", event.target.checked)
                }
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Show inactive products
            </label>
          </div>

          {products.isPending ? (
            <Skeleton variant="row" count={5} />
          ) : products.isError ? (
            <ErrorState
              message={toUserMessage(products.error)}
              detail={
                process.env.NODE_ENV === "development"
                  ? toTechnicalDetail(products.error)
                  : undefined
              }
              onRetry={() => void products.refetch()}
            />
          ) : productRows.length === 0 ? (
            <EmptyState
              icon={Package}
              title={showDeleted ? "No inactive products" : "No products yet"}
              description={
                showDeleted
                  ? "No inactive products match this search."
                  : "Add a product to start setting up the catalogue."
              }
              action={
                showDeleted ? undefined : (
                  <Button onClick={openCreate}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add product
                  </Button>
                )
              }
            />
          ) : (
            <ResponsiveTable
              rows={productRows}
              columns={columns}
              getKey={(product) => product.id}
            />
          )}
          {products.hasNextPage && (
            <div className="flex justify-center pt-3">
              <Button
                variant="secondary"
                disabled={products.isFetchingNextPage}
                onClick={() => void products.fetchNextPage()}
              >
                {products.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingProduct ? "Edit product" : "Add product"}
        size="lg"
        busy={saveMutation.isPending}
      >
        <ProductForm
          key={editingProduct?.id ?? "new-product"}
          product={editingProduct}
          fieldErrors={apiFieldErrors(saveMutation.error)}
          error={
            saveMutation.error && Object.keys(apiFieldErrors(saveMutation.error)).length === 0
              ? toUserMessage(saveMutation.error)
              : undefined
          }
          pending={saveMutation.isPending}
          onCancel={closeForm}
          onEdit={() => saveIntent.current.reset()}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
