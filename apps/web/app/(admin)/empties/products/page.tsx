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
import type {
  EmptiesProductPackagingInput,
  EmptiesTypeDto,
  ProductOwnerDto,
} from "@/lib/api/empties.api";
import { formatEmptiesCount } from "@/lib/empties-overview";
import { queryKeys } from "@/lib/query-keys";

const PAGE_SIZE = 50;

function ProductOwnerRow({
  product,
  activeOwners,
  types,
  onSaved,
}: {
  product: ProductOwnerDto;
  activeOwners: Array<{ id: string; name: string }>;
  types: EmptiesTypeDto[];
  onSaved: () => Promise<void>;
}) {
  const flow = useWriteFlow();
  const network = useNetworkStatus();
  const [selectedOwnerId, setSelectedOwnerId] = useState(product.ownerId ?? "");
  const [lastOwnerId, setLastOwnerId] = useState<string | null>(null);
  const [packaging, setPackaging] = useState(() => packagingDraft(product));
  const [lastPackaging, setLastPackaging] = useState<EmptiesProductPackagingInput | null>(null);
  const [packagingError, setPackagingError] = useState("");
  const packagingFlow = useWriteFlow();
  const ownerTypes = types.filter((type) => type.ownerId === product.ownerId);

  const mutation = useMutation({
    mutationFn: async (ownerId: string) => {
      const isRetry = ownerId === lastOwnerId;
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastOwnerId(ownerId);
      return flow.run(
        ownerId === "" ? "empties.productOwner.unassign" : "empties.productOwner.assign",
        (key) => emptiesApi.assignProductOwner(product.productId, ownerId === "" ? null : ownerId, key),
        { name: product.productName },
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      setSelectedOwnerId(result.ownerId ?? "");
      if (result.ownerId !== product.ownerId) setPackaging(emptyPackagingDraft());
      await onSaved();
    },
  });

  const packagingMutation = useMutation({
    mutationFn: async (input: EmptiesProductPackagingInput) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastPackaging);
      if (packagingFlow.status === "unknown" && !isRetry) return undefined;
      if (packagingFlow.status === "failed" && !isRetry) packagingFlow.edit();
      setLastPackaging(input);
      return packagingFlow.run(
        "empties.productPackaging.update",
        (key) => emptiesApi.assignProductPackaging(product.productId, input, key),
        { name: product.productName },
      );
    },
    onSuccess: async (result) => {
      if (result === undefined) return;
      setPackagingError("");
      await onSaved();
    },
  });

  const busy = mutation.isPending || flow.status === "unknown";
  const packagingBusy = packagingMutation.isPending || packagingFlow.status === "unknown";
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
            disabled={busy || packagingBusy || network.offline}
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
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium">Containers returned with a sale</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Suggested defaults: one bottle per retail unit, {formatEmptiesCount(product.unitsPerPack)} bottles and one crate per wholesale pack.
            </p>
          </div>
          {(["BOTTLE", "CRATE"] as const).map((kind) => {
            const draft = packaging[kind];
            const selectedType = ownerTypes.find((type) => type.id === draft.typeId);
            return (
              <div key={kind} className="grid gap-3 sm:grid-cols-3">
                <FormField
                  id={`packaging-${kind}-${product.productId}`}
                  label={`${kind === "BOTTLE" ? "Bottle" : "Crate"} type`}
                >
                  <Select
                    id={`packaging-${kind}-${product.productId}`}
                    value={draft.typeId}
                    disabled={product.ownerId === null || busy || packagingBusy || network.offline}
                    onChange={(event) => {
                      const typeId = event.target.value;
                      setPackaging((current) => ({
                        ...current,
                        [kind]: {
                          typeId,
                          retail: kind === "BOTTLE" ? "1" : "0",
                          wholesale: kind === "BOTTLE" ? String(product.unitsPerPack) : "1",
                        },
                      }));
                      setPackagingError("");
                      if (packagingFlow.status !== "unknown") packagingFlow.edit();
                    }}
                  >
                    <option value="">Not tracked</option>
                    {ownerTypes.filter((type) => type.kind === kind).map((type) => (
                      <option key={type.id} value={type.id} disabled={!type.isActive}>
                        {type.label}{type.isActive ? "" : " (inactive)"}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  id={`packaging-retail-${kind}-${product.productId}`}
                  label={`${kind === "BOTTLE" ? "Bottles" : "Crates"} per retail unit`}
                >
                  <Input
                    id={`packaging-retail-${kind}-${product.productId}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={draft.retail}
                    disabled={draft.typeId === "" || busy || packagingBusy || network.offline}
                    onChange={(event) => {
                      setPackaging((current) => ({
                        ...current,
                        [kind]: { ...current[kind], retail: event.target.value },
                      }));
                      if (packagingFlow.status !== "unknown") packagingFlow.edit();
                    }}
                  />
                </FormField>
                <FormField
                  id={`packaging-wholesale-${kind}-${product.productId}`}
                  label={`${kind === "BOTTLE" ? "Bottles" : "Crates"} per wholesale pack`}
                >
                  <Input
                    id={`packaging-wholesale-${kind}-${product.productId}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={draft.wholesale}
                    disabled={draft.typeId === "" || busy || packagingBusy || network.offline}
                    onChange={(event) => {
                      setPackaging((current) => ({
                        ...current,
                        [kind]: { ...current[kind], wholesale: event.target.value },
                      }));
                      if (packagingFlow.status !== "unknown") packagingFlow.edit();
                    }}
                  />
                </FormField>
                {draft.typeId !== "" && selectedType !== undefined && !selectedType.isActive && (
                  <p className="text-xs text-warning sm:col-span-3">
                    This type is inactive. Choose an active type or clear it before saving.
                  </p>
                )}
              </div>
            );
          })}
          {product.ownerId === null ? (
            <p className="text-xs text-muted-foreground">Assign a brewery before configuring container tracking.</p>
          ) : (
            <Button
              type="button"
              variant="secondary"
              loading={packagingMutation.isPending}
              disabled={busy || packagingBusy || network.offline}
              onClick={() => {
                const input = buildPackagingInput(packaging);
                if (typeof input === "string") {
                  setPackagingError(input);
                  return;
                }
                setPackagingError("");
                packagingMutation.mutate(input);
              }}
            >
              Save container tracking
            </Button>
          )}
          {packagingError !== "" && (
            <p className="text-sm text-danger" role="alert">{packagingError}</p>
          )}
          {packagingFlow.status !== "success" && packagingFlow.status !== "idle" && (
            <WriteFlowStatus
              flow={packagingFlow}
              onRetry={() => {
                if (lastPackaging !== null) packagingMutation.mutate(lastPackaging);
              }}
              checkHref="/empties/products"
              checkLabel="Check container settings"
              showFieldErrors
            />
          )}
        </div>
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

type PackagingDraft = Record<"BOTTLE" | "CRATE", { typeId: string; retail: string; wholesale: string }>;

function emptyPackagingDraft(): PackagingDraft {
  return {
    BOTTLE: { typeId: "", retail: "1", wholesale: "0" },
    CRATE: { typeId: "", retail: "0", wholesale: "1" },
  };
}

function packagingDraft(product: ProductOwnerDto): PackagingDraft {
  const draft = emptyPackagingDraft();
  for (const mapping of product.packaging) {
    draft[mapping.kind] = {
      typeId: mapping.typeId,
      retail: String(mapping.retailQuantityPerUnit),
      wholesale: String(mapping.wholesaleQuantityPerPack),
    };
  }
  return draft;
}

function buildPackagingInput(draft: PackagingDraft): EmptiesProductPackagingInput | string {
  const mappings: EmptiesProductPackagingInput["mappings"] = [];
  for (const kind of ["BOTTLE", "CRATE"] as const) {
    const row = draft[kind];
    if (row.typeId === "") continue;
    if (!/^\d+$/.test(row.retail) || !/^\d+$/.test(row.wholesale)) {
      return "Container conversions must be nonnegative whole numbers.";
    }
    const retail = Number(row.retail);
    const wholesale = Number(row.wholesale);
    if (
      !Number.isSafeInteger(retail) ||
      !Number.isSafeInteger(wholesale) ||
      retail < 0 ||
      wholesale < 0 ||
      retail > 2_147_483_647 ||
      wholesale > 2_147_483_647
    ) {
      return "Container conversions must be nonnegative whole numbers.";
    }
    if (retail === 0 && wholesale === 0) {
      return "Each selected empties type needs at least one nonzero conversion.";
    }
    mappings.push({
      typeId: row.typeId,
      kind,
      retailQuantityPerUnit: retail,
      wholesaleQuantityPerPack: wholesale,
    });
  }
  return { mappings };
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
  const types = useQuery({
    queryKey: queryKeys.empties.types(true),
    queryFn: () => emptiesApi.listTypes({ includeInactive: true }),
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
        title="Product empties settings"
        description="Assign each product to its brewery and configure the bottles and crates assumed returned with sales. Sales tracking stays automatic."
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
          ) : owners.isPending || types.isPending || products.isPending ? (
            <Skeleton variant="row" count={5} />
          ) : types.isError ? (
            <ErrorState
              title="Empties types could not be loaded"
              message={toUserMessage(types.error)}
              onRetry={() => void types.refetch()}
            />
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
                    types={types.data ?? []}
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
