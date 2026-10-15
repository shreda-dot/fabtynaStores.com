"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  formatNaira,
  formatStockUnits,
  type StockLocation,
  type StockMovementType,
} from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { stockApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { StockViewDto } from "@/lib/api/stock.api";
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
  const queryClient = useQueryClient();
  void queryClient;

  const [filterProductId, setFilterProductId] = useState<string>("");
  const [filterLocation, setFilterLocation] = useState<StockLocation | "ALL">(
    "ALL",
  );
  const [filterType, setFilterType] = useState<StockMovementType | "ALL">(
    "ALL",
  );

  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
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
  });

  const productNameById = new Map(
    (stock.data ?? []).map((row) => [row.productId, row.productName]),
  );

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
      render: (row) =>
        formatStockUnits(row.totalUnits, row.unitsPerPack, row.packName),
    },
    {
      header: "Worth at cost",
      render: (row) => formatNaira(row.worthAtCostKobo),
    },
    {
      header: "Retail worth (fridge)",
      render: (row) => formatNaira(row.retailWorthKobo),
    },
    {
      header: "Wholesale worth",
      render: (row) => formatNaira(row.wholesaleWorthKobo),
    },
    {
      header: "Low stock",
      render: (row) =>
        row.lowStock ? (
          <span className="text-destructive font-medium">Low stock</span>
        ) : (
          "—"
        ),
    },
  ];

  const movementColumns: ResponsiveTableColumn<StockMovementDto>[] = [
    {
      header: "Date",
      render: (m) => new Date(m.occurredAt).toLocaleString("en-NG"),
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
      render: (m) => m.type,
    },
    {
      header: "Quantity",
      render: (m) =>
        m.quantityUnits > 0
          ? `+${m.quantityUnits}`
          : m.quantityUnits.toString(),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current stock levels, value and movement history.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Current stock</h2>
        {stock.isPending ? (
          <ListLoading />
        ) : stock.isError ? (
          <ListError
            message={stock.error.message || "Stock could not be loaded."}
            retry={() => void stock.refetch()}
          />
        ) : stock.data.length === 0 ? (
          <ListEmpty message="No stock yet. Receive stock by creating a purchase." />
        ) : (
          <ResponsiveTable
            rows={stock.data}
            columns={columns}
            getKey={(row) => row.productId}
          />
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Movement history</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="f-product" className="block text-sm font-medium">
              Product
            </label>
            <select
              id="f-product"
              value={filterProductId}
              onChange={(event) => setFilterProductId(event.target.value)}
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              <option value="">All products</option>
              {stock.data?.map((row) => (
                <option key={row.productId} value={row.productId}>
                  {row.productName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-location" className="block text-sm font-medium">
              Location
            </label>
            <select
              id="f-location"
              value={filterLocation}
              onChange={(event) =>
                setFilterLocation(event.target.value as StockLocation | "ALL")
              }
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              {LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "ALL" ? "All locations" : loc.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-type" className="block text-sm font-medium">
              Type
            </label>
            <select
              id="f-type"
              value={filterType}
              onChange={(event) =>
                setFilterType(event.target.value as StockMovementType | "ALL")
              }
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              {MOVEMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === "ALL" ? "All types" : type}
                </option>
              ))}
            </select>
          </div>
        </div>

        {movements.isPending ? (
          <ListLoading />
        ) : movements.isError ? (
          <ListError
            message={
              movements.error.message || "Movements could not be loaded."
            }
            retry={() => void movements.refetch()}
          />
        ) : movements.data.length === 0 ? (
          <ListEmpty message="No movements match these filters." />
        ) : (
          <ResponsiveTable
            rows={movements.data}
            columns={movementColumns}
            getKey={(m) => m.id}
          />
        )}
      </section>
    </div>
  );
}
