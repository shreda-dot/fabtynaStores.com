"use client";

import { ArrowLeft, Package, ScrollText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { formatLagosDateTime } from "@fabtyna/shared";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { productsApi } from "@/lib/api";
import { ApiError, toTechnicalDetail, toUserMessage } from "@/lib/api/client";
import type { ProductDetailDto, ProductMovementSummaryDto } from "@/lib/api/products.api";
import { queryKeys } from "@/lib/query-keys";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const product = useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => productsApi.getById(id),
  });

  if (product.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" className="h-8 w-56" />
        <Skeleton variant="stat" count={3} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }
  if (product.isError) {
    if (product.error instanceof ApiError && product.error.kind === "not-found") {
      return (
        <EmptyState
          title="Product not found"
          description="This product may have been removed, or the link is incorrect."
          action={
            <Link href="/products" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Back to products
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        message={toUserMessage(product.error)}
        detail={process.env.NODE_ENV === "development" ? toTechnicalDetail(product.error) : undefined}
        onRetry={() => void product.refetch()}
      />
    );
  }

  const item = product.data;
  const stockRows = Array.isArray(item.stock)
    ? item.stock
    : Object.entries(item.stock ?? {}).map(([location, value]) => ({
        location,
        ...(typeof value === "object" && value !== null ? value : {}),
      }));
  const stockColumns: ResponsiveTableColumn<(typeof stockRows)[number]>[] = [
    { header: "Location", render: (row) => row.location.replace(/_/g, " ") },
    { header: "Units", align: "right", render: (row) => row.units },
    {
      header: "Packs",
      align: "right",
      render: (row) => `${row.packs} packs · ${row.remainingUnits} units`,
    },
  ];
  const movementColumns: ResponsiveTableColumn<ProductMovementSummaryDto>[] = [
    { header: "Date", render: (row) => formatLagosDateTime(row.occurredAt) },
    { header: "Type", render: (row) => row.type },
    { header: "Location", render: (row) => row.location.replace(/_/g, " ") },
    { header: "Quantity", align: "right", render: (row) => row.quantityUnits },
    { header: "Reference", render: (row) => row.reference ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        description={`${item.sku ?? "No SKU"} · ${item.category.replace(/_/g, " ")}`}
        actions={
          <Link href="/products" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to products
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader title="Retail price" />
          <CardBody><Money kobo={item.retailPriceKobo} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Wholesale price" />
          <CardBody><Money kobo={item.wholesalePriceKobo} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Average cost" />
          <CardBody><Money kobo={item.averageCostKobo} /></CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Product details"
          description={`${item.unitsPerPack} units per ${item.packName} · reorder at ${item.reorderLevelUnits} units`}
          action={<StatusBadge status={item.active === false ? "Inactive" : "Active"} />}
        />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">Sale channel</dt><dd>{item.saleChannel}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Category</dt><dd>{item.category.replace(/_/g, " ")}</dd></div>
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Stock by location" />
        <CardBody>
          {stockRows.length === 0 ? (
            <EmptyState icon={Package} title="No stock" description="Stock levels will appear here when stock is received." />
          ) : (
            <ResponsiveTable rows={stockRows} columns={stockColumns} getKey={(row) => row.location} />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent stock movements" description="The API returns up to 20 recent movements for this product." />
        <CardBody>
          {item.movements.length === 0 ? (
            <EmptyState icon={ScrollText} title="No stock movements" description="This product has not moved through stock yet." />
          ) : (
            <ResponsiveTable rows={item.movements} columns={movementColumns} getKey={(row) => row.id} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
