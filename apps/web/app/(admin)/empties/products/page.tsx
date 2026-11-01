"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { emptiesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type { ProductOwnerDto } from "@/lib/api/empties.api";
import { formatEmptiesCount } from "@/lib/empties-overview";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/stores/toast-store";

const PAGE_SIZE = 50;

function ProductOwnerRow({
  product,
  activeOwners,
  onSaved,
}: {
  product: ProductOwnerDto;
  activeOwners: Array<{ id: string; name: string }>;
  onSaved: () => Promise<void>;
}) {
  const flow = useWriteFlow();
  const network = useNetworkStatus();
  const [selectedOwnerId, setSelectedOwnerId] = useState(product.ownerId ?? "");
  const [lastOwnerId, setLastOwnerId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (ownerId: string) => {
      const isRetry = ownerId === lastOwnerId;
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastOwnerId(ownerId);
      return flow.run((key) =>
        emptiesApi.assignProductOwner(product.productId, ownerId === "" ? null : ownerId, key),
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      setSelectedOwnerId(result.ownerId ?? "");
      toast.success(`${product.productName} brewery assignment saved.`);
      await onSaved();
    },
  });

  const busy = mutation.isPending || flow.status === "unknown";
  const inactiveOwnerOption =
    product.ownerId !== null &&
    product.ownerIsActive === false &&
    !activeOwners.some((owner) => owner.id === product.ownerId)
      ? { id: product.ownerId, name: `${product.ownerName ?? "Inactive brewery"} (inactive)` }
      : null;

  return (
    <Card>
      <CardBody className="space-y-3 p-4">
        <div>
          <p className="font-medium">{product.productName}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {product.sku ?? "No SKU"} · {formatEmptiesCount(product.unitsPerPack)} units per pack
          </p>
        </div>
        <FormField id={`product-owner-${product.productId}`} label="Brewery">
          <Select
            id={`product-owner-${product.productId}`}
            value={selectedOwnerId}
            disabled={busy || network.offline}
            onChange={(event) => {
              const nextOwnerId = event.target.value;
              setSelectedOwnerId(nextOwnerId);
              if (flow.status !== "unknown") flow.edit();
              mutation.mutate(nextOwnerId);
            }}
          >
            <option value="">Unassigned</option>
            {inactiveOwnerOption !== null && (
              <option value={inactiveOwnerOption.id}>{inactiveOwnerOption.name}</option>
            )}
            {activeOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </Select>
        </FormField>
        {flow.status === "success" && (
          <p role="status" className="text-sm font-medium text-success">
            Saved
          </p>
        )}
        {flow.status !== "success" && flow.status !== "idle" && (
          <WriteFlowStatus
            flow={flow}
            onRetry={() => {
              if (lastOwnerId !== null) mutation.mutate(lastOwnerId);
            }}
            checkHref="/empties/products"
            checkLabel="Check assignments"
            showFieldErrors
          />
        )}
      </CardBody>
    </Card>
  );
}

export default function EmptiesProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [assigned, setAssigned] = useState<"all" | "assigned" | "unassigned">("all");
  const debouncedSearch = useDebouncedValue(search, 250);
  const filters = useMemo(
    () => ({
      q: debouncedSearch.trim() || undefined,
      assigned,
      limit: PAGE_SIZE,
    }),
    [assigned, debouncedSearch],
  );

  const owners = useQuery({
    queryKey: queryKeys.empties.owners(false),
    queryFn: () => emptiesApi.listOwners(),
    enabled: !isMockApiMode,
  });
  const products = useInfiniteQuery({
    queryKey: queryKeys.empties.productOwnerPages(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => emptiesApi.listProductOwners({ ...filters, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    enabled: !isMockApiMode,
  });
  const rows = products.data?.pages.flatMap((page) => page.items) ?? [];
  const loadMoreFailed = products.isFetchNextPageError;
  const productError: unknown = products.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assign products to breweries"
        description="Choose the brewery that owns each returnable product. Changes save immediately."
        actions={
          <Link href="/empties" className={buttonClasses({ variant: "secondary" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to empties
          </Link>
        }
      />

      {isMockApiMode ? (
        <EmptyState
          title="Not available with demo data"
          description="Product ownership needs the real server. Switch the app to real mode to use it."
        />
      ) : (
        <>
          <Card>
            <CardBody className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-end">
              <FormField id="empties-product-search" label="Search products">
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="empties-product-search"
                    className="pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Name or SKU"
                    autoComplete="off"
                  />
                </div>
              </FormField>
              <FormField id="empties-product-assigned" label="Brewery assignment">
                <Select
                  id="empties-product-assigned"
                  value={assigned}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "all" || value === "assigned" || value === "unassigned") {
                      setAssigned(value);
                    }
                  }}
                >
                  <option value="all">All products</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="assigned">Assigned</option>
                </Select>
              </FormField>
            </CardBody>
          </Card>

          {owners.isError ? (
            <ErrorState
              title="Breweries could not be loaded"
              message={toUserMessage(owners.error)}
              onRetry={() => void owners.refetch()}
            />
          ) : owners.isPending || products.isPending ? (
            <Skeleton variant="row" count={5} />
          ) : products.isError && !loadMoreFailed ? (
            <ErrorState
              title="Products could not be loaded"
              message={toUserMessage(productError)}
              onRetry={() => void products.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No products found"
              description="Try a different search or assignment filter."
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {formatEmptiesCount(rows.length)} products shown
                {products.hasNextPage ? " (more available)" : ""}.
              </p>
              <div className="space-y-3">
                {rows.map((product) => (
                  <ProductOwnerRow
                    key={product.productId}
                    product={product}
                    activeOwners={(owners.data ?? []).map(({ id, name }) => ({ id, name }))}
                    onSaved={() =>
                      queryClient.invalidateQueries({ queryKey: queryKeys.empties.all })
                    }
                  />
                ))}
              </div>
              {loadMoreFailed && (
                <ErrorState
                  title="More products could not be loaded"
                  message={toUserMessage(productError)}
                  onRetry={() => void products.fetchNextPage()}
                />
              )}
              {products.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    loading={products.isFetchingNextPage}
                    onClick={() => void products.fetchNextPage()}
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
