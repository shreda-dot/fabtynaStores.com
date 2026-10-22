"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDateTime, formatStockUnits } from "@fabtyna/shared";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { productsApi, transfersApi } from "@/lib/api";
import type { TransferLineWithProductDto } from "@/lib/api/transfers.api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const transfer = useQuery({
    queryKey: queryKeys.transfers.detail(id),
    queryFn: () => transfersApi.getById(id),
  });

  const products = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });

  const productById = useMemo(() => {
    const map = new Map<
      string,
      { name: string; unitsPerPack: number; packName: string }
    >();
    for (const product of products.data ?? []) {
      map.set(product.id, {
        name: product.name,
        unitsPerPack: product.unitsPerPack,
        packName: product.packName,
      });
    }
    return map;
  }, [products.data]);

  const backLink = (
    <Link href="/transfers" className={buttonClasses({ variant: "secondary" })}>
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back
    </Link>
  );

  if (transfer.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" count={2} className="max-w-sm" />
        <Skeleton variant="stat" count={4} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }

  if (transfer.isError) {
    const notFound =
      transfer.error instanceof ApiError && transfer.error.kind === "not-found";
    if (notFound) {
      return (
        <EmptyState
          title="Transfer not found"
          description="This transfer may have been removed, or the link is incorrect."
          action={
            <Link href="/transfers" className={buttonClasses({})}>
              Back to transfers
            </Link>
          }
          className="mt-8"
        />
      );
    }
    return (
      <ErrorState
        title="Transfer could not be loaded"
        message={toUserMessage(transfer.error)}
        onRetry={() => void transfer.refetch()}
        className="mt-8"
      />
    );
  }

  if (!transfer.data) {
    return (
      <EmptyState
        title="Transfer not found"
        description="This transfer may have been removed, or the link is incorrect."
        action={
          <Link href="/transfers" className={buttonClasses({})}>
            Back to transfers
          </Link>
        }
        className="mt-8"
      />
    );
  }

  const t = transfer.data;
  const reference = t.reference ?? t.id.slice(0, 8);

  const lineColumns: ResponsiveTableColumn<TransferLineWithProductDto>[] = [
    {
      header: "Product",
      render: (line) =>
        productById.get(line.productId)?.name ??
        line.productName ??
        line.productId.slice(0, 8),
    },
    {
      header: "Quantity",
      align: "right",
      render: (line) => {
        const product = productById.get(line.productId);
        return (
          <span className="tabular">
            {product
              ? formatStockUnits(
                  line.quantityUnits,
                  product.unitsPerPack,
                  product.packName,
                )
              : `${line.quantityUnits} units`}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Transfer ${reference}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span>{formatLagosDateTime(t.transferredAt)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {t.from.replace(/_/g, " ")} → {t.to.replace(/_/g, " ")}
            </span>
          </span>
        }
        actions={backLink}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">From</p>
            <p className="mt-1 font-medium">{t.from.replace(/_/g, " ")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">To</p>
            <p className="mt-1 font-medium">{t.to.replace(/_/g, " ")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">Date</p>
            <p className="mt-1 font-medium">{formatLagosDateTime(t.transferredAt)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">Reason</p>
            <p className="mt-1 font-medium">{t.reason ?? "—"}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Items transferred"
          description="Transfers are immutable and cannot be voided. To correct this, make an opposite transfer."
        />
        <CardBody>
          <ResponsiveTable
            rows={t.lines}
            columns={lineColumns}
            getKey={(line) => line.id}
          />
        </CardBody>
      </Card>
    </div>
  );
}
