"use client";

import { useId, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History, Package } from "lucide-react";
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
import { Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { stockApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
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
  const businessDate = useLagosBusinessDate();

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

  const stockRows = stock.data ?? [];

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
      header: "Retail worth (fridge)",
      align: "right",
      render: (row) => <Money kobo={row.retailWorthKobo} />,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description="Current stock levels, value and movement history."
      />

      <Card>
        <CardHeader
          title="Current stock"
          description={
            <span className="inline-flex items-center gap-1">
              Stock levels and value by location
              <InfoHint label="Explain current stock worth">
                “Worth at cost” values every unit at the average purchase cost.
                “Retail worth (fridge)” values retail-shelf stock at retail
                price. “Wholesale worth” values full warehouse packs at the
                wholesale price.
              </InfoHint>
            </span>
          }
        />
        <CardBody>
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
            <ResponsiveTable
              rows={stockRows}
              columns={columns}
              getKey={(row) => row.productId}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Movement history"
          description="Every stock in and out, newest first."
        />
        <CardBody className="space-y-4">
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
        </CardBody>
      </Card>
    </div>
  );
}
