"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { emptiesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type {
  PurchaseEmptiesSetupInput,
  PurchaseEmptiesSetupItem,
  EmptiesTypeDto,
} from "@/lib/api/empties.api";
import { formatEmptiesCount } from "@/lib/empties-overview";
import { queryKeys } from "@/lib/query-keys";

function ProductSetupRow({
  product,
  types,
  refresh,
}: {
  product: PurchaseEmptiesSetupItem;
  types: EmptiesTypeDto[];
  refresh: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const flow = useWriteFlow();
  const [classification, setClassification] = useState<"" | "RETURNABLE" | "NON_RETURNABLE">(product.classification ?? "");
  const [crateTypeId, setCrateTypeId] = useState(() => {
    const saved = product.mappings.find((mapping) => mapping.kind === "CRATE");
    const suggestion = product.salePackagingSuggestions.find((mapping) => mapping.kind === "CRATE");
    return saved?.typeId ?? suggestion?.typeId ?? "";
  });
  const [crateCount, setCrateCount] = useState(() => {
    const saved = product.mappings.find((mapping) => mapping.kind === "CRATE");
    const suggestion = product.salePackagingSuggestions.find((mapping) => mapping.kind === "CRATE");
    return String(saved?.countPerPack ?? suggestion?.wholesaleQuantityPerPack ?? "");
  });
  const [bottleTypeId, setBottleTypeId] = useState(() => {
    const saved = product.mappings.find((mapping) => mapping.kind === "BOTTLE");
    const suggestion = product.salePackagingSuggestions.find((mapping) => mapping.kind === "BOTTLE");
    return saved?.typeId ?? suggestion?.typeId ?? "";
  });
  const [bottleCount, setBottleCount] = useState(() => {
    const saved = product.mappings.find((mapping) => mapping.kind === "BOTTLE");
    const suggestion = product.salePackagingSuggestions.find((mapping) => mapping.kind === "BOTTLE");
    return String(saved?.countPerUnit ?? suggestion?.retailQuantityPerUnit ?? "");
  });
  const [error, setError] = useState("");
  const [lastInput, setLastInput] = useState<PurchaseEmptiesSetupInput | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: PurchaseEmptiesSetupInput) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastInput);
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastInput(input);
      return flow.run(
        "empties.purchaseSetup.save",
        (key) => emptiesApi.setPurchaseSetup(product.productId, input, key),
        { name: product.productName },
      );
    },
    onSuccess: async (result) => {
      if (result === undefined) return;
      setError("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      await refresh();
    },
    onError: (cause) => setError(toUserMessage(cause)),
  });

  function save() {
    if (classification === "") {
      setError("Choose whether this product is returnable before saving.");
      return;
    }
    const mappings: PurchaseEmptiesSetupInput["mappings"] = [];
    if (classification === "RETURNABLE") {
      if (product.ownerId === null) {
        setError("Assign this product to a brewery first in Empties → Product owners.");
        return;
      }
      if (crateTypeId !== "") {
        const count = Number(crateCount);
        if (!Number.isSafeInteger(count) || count < 1) {
          setError("Enter a whole-crate count per pack.");
          return;
        }
        mappings.push({ kind: "CRATE", typeId: crateTypeId, countPerPack: count });
      }
      if (bottleTypeId !== "") {
        const count = Number(bottleCount);
        if (!Number.isSafeInteger(count) || count < 1) {
          setError("Enter a whole-bottle count per unit.");
          return;
        }
        mappings.push({ kind: "BOTTLE", typeId: bottleTypeId, countPerUnit: count });
      }
      if (mappings.length === 0) {
        setError("Choose at least one purchase container type for a returnable product.");
        return;
      }
    }
    setError("");
    mutation.mutate({ classification, mappings });
  }

  const productTypes = types.filter((type) => type.ownerId === product.ownerId);
  const status = product.classification === null
    ? "Not set"
    : product.classification === "NON_RETURNABLE"
      ? "Non-returnable"
      : `Returnable · ${product.mappings.map((mapping) => mapping.kind.toLowerCase()).join(" + ") || "containers not set"}`;

  return (
    <Card>
      <CardBody className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-medium">
              {product.productName}
              {!product.isActive && <span className="ml-2 text-xs text-muted-foreground">Inactive product</span>}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {product.sku ?? "No SKU"} · {product.ownerName ?? "No brewery assigned"} · {formatEmptiesCount(product.unitsPerPack)} units per pack
            </p>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{status}</span>
        </div>
        <FormField id={`classification-${product.productId}`} label="Purchase classification">
          <Select
            id={`classification-${product.productId}`}
            value={classification}
            disabled={mutation.isPending || flow.status === "unknown" || network.offline}
            onChange={(event) => {
              setClassification(event.target.value as "" | "RETURNABLE" | "NON_RETURNABLE");
              setError("");
            }}
          >
            <option value="">Choose one</option>
            <option value="RETURNABLE">Returnable containers required</option>
            <option value="NON_RETURNABLE">Non-returnable</option>
          </Select>
        </FormField>
        {classification === "RETURNABLE" && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm text-muted-foreground">
              Sale packaging suggestions are prefilled when available. Check and save the purchase counts separately.
            </p>
            {(["CRATE", "BOTTLE"] as const).map((kind) => {
              const isCrate = kind === "CRATE";
              const typeId = isCrate ? crateTypeId : bottleTypeId;
              const count = isCrate ? crateCount : bottleCount;
              const suggested = product.salePackagingSuggestions.some((mapping) => mapping.kind === kind);
              return (
                <div key={kind} className="grid gap-3 sm:grid-cols-2">
                  <FormField id={`${kind}-${product.productId}`} label={`${kind === "CRATE" ? "Crate" : "Bottle"} type`}>
                    <Select
                      id={`${kind}-${product.productId}`}
                      value={typeId}
                      disabled={mutation.isPending || flow.status === "unknown" || network.offline || product.ownerId === null}
                      onChange={(event) => isCrate ? setCrateTypeId(event.target.value) : setBottleTypeId(event.target.value)}
                    >
                      <option value="">Not used for this product</option>
                      {productTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}{type.isActive ? "" : " (inactive)"}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField
                    id={`${kind}-count-${product.productId}`}
                    label={isCrate ? "Crates per full pack" : "Bottles per unit"}
                    hint={suggested ? "Prefilled from sale packaging; confirm before saving." : undefined}
                  >
                    <Input
                      id={`${kind}-count-${product.productId}`}
                      type="number"
                      min="1"
                      step="1"
                      value={count}
                      disabled={mutation.isPending || flow.status === "unknown" || network.offline}
                      onChange={(event) => isCrate ? setCrateCount(event.target.value) : setBottleCount(event.target.value)}
                    />
                  </FormField>
                </div>
              );
            })}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={save}
            loading={mutation.isPending}
            disabled={mutation.isPending || flow.status === "unknown" || network.offline}
          >
            <Check aria-hidden="true" className="h-4 w-4" />
            Confirm setup
          </Button>
        </div>
        <WriteFlowStatus
          flow={flow}
          onRetry={() => { if (lastInput) mutation.mutate(lastInput); }}
          checkHref="/empties/purchase-setup"
          checkLabel="Check product setup"
          showFieldErrors
        />
      </CardBody>
    </Card>
  );
}

export default function PurchaseEmptiesSetupPage() {
  const queryClient = useQueryClient();
  const demo = isMockApiMode;
  const types = useQuery({
    queryKey: queryKeys.empties.types(true),
    queryFn: () => emptiesApi.listTypes({ includeInactive: true }),
    enabled: !demo,
  });
  const products = useInfiniteQuery({
    queryKey: queryKeys.empties.purchaseSetup(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => emptiesApi.listPurchaseSetup({ cursor: pageParam, limit: 200 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !demo,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.empties.purchaseSetup() });
  };

  if (demo) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title="Purchase empties setup" description="Classify products and confirm their purchase containers." />
        <p role="status" className="rounded-md border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          Product empties setup and supplier empties ledgers are not available in demo mode. Demo purchases skip these checks.
        </p>
      </div>
    );
  }
  if (types.isError || products.isError) {
    const cause = types.error ?? products.error;
    return <ErrorState title="Purchase setup could not be loaded" message={toUserMessage(cause)} onRetry={() => {
      void types.refetch();
      void products.refetch();
    }} />;
  }

  const items = products.data?.pages.flatMap((page) => page.items) ?? [];
  const notSet = items.filter((product) => product.classification === null).length;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Purchase empties setup"
        description="Classify every product before purchases are resumed. Suggestions come from sale packaging and must be confirmed."
        actions={<Link href="/empties" className={buttonClasses({ variant: "secondary" })}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back to empties</Link>}
      />
      {notSet > 0 && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          {notSet} product{notSet === 1 ? " is" : "s are"} not classified on this page. Purchases for unclassified products are blocked until setup is confirmed.
        </p>
      )}
      {products.isPending ? (
        <Skeleton variant="row" count={4} />
      ) : items.length === 0 ? (
        <EmptyState title="No products found" description="Create products first, then classify them here." />
      ) : (
        <div className="space-y-3">
          {items.map((product) => (
            <ProductSetupRow key={product.productId} product={product} types={types.data ?? []} refresh={refresh} />
          ))}
        </div>
      )}
      {products.hasNextPage && (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>
            {products.isFetchingNextPage ? "Loading…" : "Load more products"}
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        If a returnable product has no brewery or container type, set those up first in <Link href="/empties/products" className="text-primary hover:underline">Product owners and sale packaging</Link>.
      </p>
    </div>
  );
}
