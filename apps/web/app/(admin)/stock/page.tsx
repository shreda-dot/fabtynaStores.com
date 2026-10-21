"use client";

import { useId, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { History, Package, Search } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDateTime,
  formatStockUnits,
  getLagosBusinessDate,
  type StockLocation,
  type StockMovementType,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { InfoHint } from "@/components/info-hint";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { isMockApiMode, stockApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type {
  LowStockItemDto,
  StockViewDto,
} from "@/lib/api/stock.api";
import type { StockMovementDto } from "@fabtyna/shared";

const LOCATIONS: (StockLocation | "ALL")[] = [
  "ALL",
  "WAREHOUSE",
  "RETAIL_SHELF",
  "MARKET",
];

const MOVEMENT_TYPES: (StockMovementType | "ALL")[] = [
  "ALL",
  "PURCHASE",
  "SALE",
  "TRANSFER",
  "ADJUSTMENT",
  "RETURN",
];

export default function StockPage() {
  const productFieldId = useId();
  const locationFieldId = useId();
  const typeFieldId = useId();
  const dateFieldId = useId();

  const [filterProductId, setFilterProductId] = useState<string>("");
  const [filterLocation, setFilterLocation] = useState<StockLocation | "ALL">(
    "ALL",
  );
  const [filterType, setFilterType] = useState<StockMovementType | "ALL">("ALL");
  const [filterDate, setFilterDate] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const businessDate = useLagosBusinessDate();
  const debouncedStockSearch = useDebouncedValue(stockSearch, 250);

  const stock = useInfiniteQuery({
    queryKey: [...queryKeys.stock.list, debouncedStockSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      return stockApi.listPage({
        search: debouncedStockSearch,
        cursor: pageParam,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const lowStock = useInfiniteQuery({
    queryKey: [...queryKeys.stock.all, "low", debouncedStockSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      stockApi.lowStock({ search: debouncedStockSearch, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const movements = useQuery({
    queryKey: queryKeys.stock.movements({
      productId: filterProductId || undefined,
      location: filterLocation === "ALL" ? undefined : filterLocation,
      type: filterType === "ALL" ? undefined : filterType,
    }),
    queryFn: () =>
      stockApi.movements({
        productId: filterProductId || undefined,
        location: filterLocation === "ALL" ? undefined : filterLocation,
        type: filterType === "ALL" ? undefined : filterType,
      }),
    placeholderData: keepPreviousData,
    enabled: isMockApiMode,
  });

  const stockRows = stock.data?.pages.flatMap((page) => page.items) ?? [];
  const lowStockRows =
    lowStock.data?.pages.flatMap((page) => page.items) ?? [];
  const productNameById = new Map(
    stockRows.map((row) => [row.productId, row.productName]),
  );

  const movementRows = [...(movements.data ?? [])]
    .filter(
      (m) =>
        filterDate === "" ||
        getLagosBusinessDate(new Date(m.occurredAt)) === filterDate,
    )
    .sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

  const hasActiveFilters =
    filterProductId !== "" ||
    filterLocation !== "ALL" ||
    filterType !== "ALL" ||
    filterDate !== "";

  function clearFilters() {
    setFilterProductId("");
    setFilterLocation("ALL");
    setFilterType("ALL");
    setFilterDate("");
  }

  const columns: ResponsiveTableColumn<StockViewDto>[] = [
    {
      header: "Product",
      render: (row) => (
        <div>
          <p className="font-medium">{row.productName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.sku ?? "No SKU"}
          </p>
        </div>
      ),
    },
    {
      header: "By location",
      render: (row) =>
        row.byLocation.length === 0
          ? "No stock"
          : row.byLocation
              .map(
                (b) =>
                  `${b.location.replace(/_/g, " ")}: ${formatStockUnits(
                    b.quantityUnits,
                    row.unitsPerPack,
                    row.packName,
                  )}`,
              )
              .join(", "),
    },
    {
      header: "Total units",
      align: "right",
      render: (row) => (
        <span className="tabular">
          {formatStockUnits(row.totalUnits, row.unitsPerPack, row.packName)}
        </span>
      ),
    },
    {
      header: "Worth at cost",
      align: "right",
      render: (row) => <Money kobo={row.worthAtCostKobo} />,
    },
    {
      header: isMockApiMode ? "Retail worth (fridge)" : "Worth at retail price",
      align: "right",
      render: (row) => (
        <Money
          kobo={
            isMockApiMode
              ? row.retailWorthKobo ?? "0"
              : row.worthAtRetailKobo ?? row.retailWorthKobo ?? "0"
          }
        />
      ),
    },
    {
      header: "Wholesale worth",
      align: "right",
      render: (row) => <Money kobo={row.wholesaleWorthKobo} />,
    },
    {
      header: "Low stock",
      align: "center",
      render: (row) =>
        row.lowStock ? <Badge tone="danger">Low stock</Badge> : "—",
    },
  ];

  const movementColumns: ResponsiveTableColumn<StockMovementDto>[] = [
    {
      header: "Date",
      render: (m) => formatLagosDateTime(m.occurredAt),
    },
    {
      header: "Product",
      render: (m) => productNameById.get(m.productId) ?? m.productId,
    },
    {
      header: "Location",
      render: (m) => m.location.replace(/_/g, " "),
    },
    {
      header: "Type",
      render: (m) => <Badge tone="neutral">{m.type}</Badge>,
    },
    {
      header: "Quantity",
      align: "right",
      render: (m) => (
        <span className="tabular">
          {m.quantityUnits > 0 ? `+${m.quantityUnits}` : m.quantityUnits.toString()}
        </span>
      ),
    },
  ];

  const totals = stock.data?.pages[0]?.totals;
  const lowStockColumns: ResponsiveTableColumn<LowStockItemDto>[] = [
    {
      header: "Product",
      render: (row) => (
        <Link href={`/products/${row.id}`} className="font-medium text-primary hover:underline">
          {row.name}
        </Link>
      ),
    },
    { header: "SKU", render: (row) => row.sku ?? "—" },
    { header: "On hand", align: "right", render: (row) => row.units },
    { header: "Reorder at", align: "right", render: (row) => row.reorderLevelUnits },
    { header: "Shortfall", align: "right", render: (row) => row.shortfallUnits },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description="Current stock levels, value and low-stock alerts."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total units"
          value={totals?.units ?? stockRows.reduce((sum, row) => sum + row.totalUnits, 0)}
          hint={totals?.includeInactiveProducts ? "Includes inactive products" : undefined}
        />
        <StatCard label="Worth at cost" value={<Money kobo={totals?.worthAtCostKobo ?? stockRows.reduce((sum, row) => sum + BigInt(row.worthAtCostKobo), 0n)} />} />
        <StatCard label="Retail worth" value={<Money kobo={totals?.worthAtRetailKobo ?? stockRows.reduce((sum, row) => sum + BigInt(row.worthAtRetailKobo ?? row.retailWorthKobo ?? "0"), 0n).toString()} />} />
        <StatCard label="Wholesale worth" value={<Money kobo={totals?.worthAtWholesaleKobo ?? stockRows.reduce((sum, row) => sum + BigInt(row.wholesaleWorthKobo), 0n)} />} />
      </div>

      <Card>
        <CardHeader
          title="Current stock"
          description={
            <span className="inline-flex items-center gap-1">
              Stock levels and value by location
              <InfoHint label="Explain current stock worth">
                “Worth at cost” values every unit at the average purchase cost.
                {isMockApiMode
                  ? " “Retail worth (fridge)” values retail-shelf stock at retail price."
                  : " “Worth at retail price” values on-hand units at the product's retail price."}
                {" “Wholesale worth” values stock at the wholesale pack price."}
              </InfoHint>
            </span>
          }
        />
        <CardBody>
          <label className="relative mb-4 block max-w-md">
            <span className="sr-only">Search stock products</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={stockSearch}
              onChange={(event) => setStockSearch(event.target.value)}
              placeholder="Search products"
              className="pl-9"
            />
          </label>
          {stock.isPending ? (
            <Skeleton variant="row" count={6} />
          ) : stock.isError ? (
            <ErrorState
              message={toUserMessage(stock.error)}
              onRetry={() => void stock.refetch()}
            />
          ) : stockRows.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No stock yet"
              description="Stock appears here once you receive items through a purchase."
              action={
                <Link
                  href="/purchases/new"
                  className={buttonClasses({ variant: "primary" })}
                >
                  Receive stock
                </Link>
              }
            />
          ) : (
            <>
              <ResponsiveTable
                rows={stockRows}
                columns={columns}
                getKey={(row) => row.productId}
              />
              {stock.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    disabled={stock.isFetchingNextPage}
                    onClick={() => void stock.fetchNextPage()}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    {stock.isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Low stock" description="Products at or below their reorder level." />
        <CardBody>
          {lowStock.isPending ? (
            <Skeleton variant="row" count={4} />
          ) : lowStock.isError ? (
            <ErrorState
              message={toUserMessage(lowStock.error)}
              onRetry={() => void lowStock.refetch()}
            />
          ) : lowStockRows.length === 0 ? (
            <EmptyState icon={Package} title="No low-stock products" description="No products currently need replenishment." />
          ) : (
            <>
              <ResponsiveTable rows={lowStockRows} columns={lowStockColumns} getKey={(row) => row.id} />
              {lowStock.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    disabled={lowStock.isFetchingNextPage}
                    onClick={() => void lowStock.fetchNextPage()}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    {lowStock.isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Movement history"
          description={
            isMockApiMode
              ? "Every stock in and out, newest first."
              : "Movement history is not available in the real API yet."
          }
        />
        <CardBody className="space-y-4">
          {!isMockApiMode ? (
            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Movement history is not available in the real API yet. Current stock and low-stock lists are connected.
            </div>
          ) : (
            <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id={productFieldId} label="Product">
              <Select
                id={productFieldId}
                value={filterProductId}
                onChange={(event) => setFilterProductId(event.target.value)}
              >
                <option value="">All products</option>
                {stockRows.map((row) => (
                  <option key={row.productId} value={row.productId}>
                    {row.productName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id={locationFieldId} label="Location">
              <Select
                id={locationFieldId}
                value={filterLocation}
                onChange={(event) =>
                  setFilterLocation(event.target.value as StockLocation | "ALL")
                }
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc === "ALL" ? "All locations" : loc.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id={typeFieldId} label="Type">
              <Select
                id={typeFieldId}
                value={filterType}
                onChange={(event) =>
                  setFilterType(event.target.value as StockMovementType | "ALL")
                }
              >
                {MOVEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === "ALL" ? "All types" : type}
                  </option>
                ))}
              </Select>
            </FormField>
            <DateFilter
              id={dateFieldId}
              value={filterDate}
              onChange={setFilterDate}
              max={businessDate}
            />
          </div>

          {movements.isPending ? (
            <Skeleton variant="row" count={5} />
          ) : movements.isError ? (
            <ErrorState
              message={toUserMessage(movements.error)}
              onRetry={() => void movements.refetch()}
            />
          ) : movementRows.length === 0 ? (
            <EmptyState
              icon={History}
              title="No movements found"
              description={
                hasActiveFilters
                  ? "No stock movements match the current filters."
                  : "Stock movements will appear here as you buy, sell and transfer stock."
              }
              action={
                hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    Clear filters
                  </button>
                ) : (
                  <Link
                    href="/transfers/new"
                    className={buttonClasses({ variant: "primary" })}
                  >
                    New transfer
                  </Link>
                )
              }
            />
          ) : (
            <ResponsiveTable
              rows={movementRows}
              columns={movementColumns}
              getKey={(m) => m.id}
            />
          )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
