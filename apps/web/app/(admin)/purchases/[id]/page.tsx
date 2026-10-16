"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDateTime } from "@fabtyna/shared";
import { ResponsiveTable } from "@/components/responsive-table";
import type { ResponsiveTableColumn } from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { purchasesApi } from "@/lib/api";
import type { PurchaseLineWithProductDto } from "@/lib/api/purchases.api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const id = params.id;

  const purchase = useQuery({
    queryKey: queryKeys.purchases.detail(id),
    queryFn: () => purchasesApi.getById(id),
  });

  const voidMutation = useMutation({
    mutationFn: () => purchasesApi.void(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      void purchase.refetch();
    },
  });

  if (purchase.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" count={2} className="max-w-sm" />
        <Skeleton variant="stat" count={3} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }

  if (purchase.isError) {
    const notFound =
      purchase.error instanceof ApiError && purchase.error.kind === "not-found";
    if (notFound) {
      return (
        <EmptyState
          title="Purchase not found"
          description="This purchase may have been removed, or the link is incorrect."
          action={
            <Link href="/purchases" className={buttonClasses({})}>
              Back to purchases
            </Link>
          }
          className="mt-8"
        />
      );
    }
    return (
      <ErrorState
        title="Purchase could not be loaded"
        message={toUserMessage(purchase.error)}
        onRetry={() => void purchase.refetch()}
        className="mt-8"
      />
    );
  }

  if (!purchase.data) {
    return (
      <EmptyState
        title="Purchase not found"
        description="This purchase may have been removed, or the link is incorrect."
        action={
          <Link href="/purchases" className={buttonClasses({})}>
            Back to purchases
          </Link>
        }
        className="mt-8"
      />
    );
  }

  const p = purchase.data;
  const isVoided = p.status === "VOIDED";
  const reference = p.reference ?? p.id.slice(0, 8);

  const columns: ResponsiveTableColumn<PurchaseLineWithProductDto>[] = [
    { header: "Product", render: (line) => line.productName },
    { header: "Unit", render: (line) => line.unit },
    {
      header: "Quantity",
      align: "right",
      render: (line) => (
        <span className="tabular">
          {line.quantity} ({line.quantityUnits} units)
        </span>
      ),
    },
    {
      header: "Unit cost",
      align: "right",
      render: (line) => <Money kobo={line.unitCostKobo} tone="neutral" />,
    },
    {
      header: "Line total",
      align: "right",
      render: (line) => <Money kobo={line.lineTotalKobo} tone="neutral" />,
    },
  ];

  async function tryVoid() {
    if (isVoided) return;
    await confirm({
      title: "Void this purchase?",
      tone: "danger",
      confirmLabel: "Void purchase",
      cancelLabel: "Keep purchase",
      description: "This cannot be undone.",
      details: (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Stock received in this purchase will be removed again.</li>
          <li>The supplier ledger entry from this purchase will be reversed.</li>
          <li>
            The record stays in the history marked <strong>VOIDED</strong>.
          </li>
        </ul>
      ),
      onConfirm: () => voidMutation.mutateAsync(),
      successMessage: `Purchase ${reference} voided.`,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Purchase ${reference}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{formatLagosDateTime(p.purchasedAt)}</span>
            <StatusBadge status={p.status} />
          </span>
        }
        actions={
          <>
            <Link
              href="/purchases"
              className={buttonClasses({ variant: "secondary" })}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </Link>
            {!isVoided && (
              <>
                <Link
                  href={`/purchases/${p.id}/edit`}
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                  Edit purchase
                </Link>
                <Button
                  variant="danger"
                  loading={voidMutation.isPending}
                  disabled={network.offline}
                  onClick={() => void tryVoid()}
                >
                  <Ban aria-hidden="true" className="h-4 w-4" />
                  Void purchase
                </Button>
              </>
            )}
          </>
        }
      />

      {isVoided && (
        <div
          role="status"
          className="rounded-md border border-danger/30 bg-danger-surface p-4 text-sm text-danger"
        >
          <p className="font-semibold">This purchase is voided</p>
          <p className="mt-1">
            Stock movements and the supplier ledger entry were reversed. The
            record is kept for audit and cannot be edited.
          </p>
        </div>
      )}

      {voidMutation.isError && (
        <ErrorState
          title="Cannot void this purchase"
          message={toUserMessage(voidMutation.error)}
        />
      )}

      <div
        className={isVoided ? "space-y-6 opacity-70 saturate-50" : "space-y-6"}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Supplier</p>
              <p className="mt-1 font-medium">{p.supplier?.name ?? "No supplier"}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Reference</p>
              <p className="mt-1 font-medium">{p.reference ?? "—"}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="mt-1 font-semibold">
                <Money kobo={p.totalKobo} tone="neutral" />
              </p>
            </CardBody>
          </Card>
        </div>

        {p.notes && (
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="mt-1 text-sm">{p.notes}</p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Lines" />
          <CardBody>
            <ResponsiveTable
              rows={p.lines}
              columns={columns}
              getKey={(line) => line.id}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
