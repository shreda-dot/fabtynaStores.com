"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatLagosDateTime } from "@fabtyna/shared";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { adjustmentsApi } from "@/lib/api";
import type { AdjustmentLineWithProductDto } from "@/lib/api/adjustments.api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

export default function AdjustmentDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const id = params.id;

  const adjustment = useQuery({
    queryKey: queryKeys.adjustments.detail(id),
    queryFn: () => adjustmentsApi.getById(id),
  });

  const voidMutation = useMutation({
    mutationFn: () => adjustmentsApi.void(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adjustments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      void adjustment.refetch();
    },
    onError: (error) => {
      toast.error(toUserMessage(error));
    },
  });

  if (adjustment.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" count={2} className="max-w-sm" />
        <Skeleton variant="stat" count={2} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }

  if (adjustment.isError) {
    const notFound =
      adjustment.error instanceof ApiError && adjustment.error.kind === "not-found";
    if (notFound) {
      return (
        <EmptyState
          title="Adjustment not found"
          description="This adjustment may have been removed, or the link is incorrect."
          action={
            <Link href="/adjustments" className={buttonClasses({})}>
              Back to adjustments
            </Link>
          }
          className="mt-8"
        />
      );
    }
    return (
      <ErrorState
        title="Adjustment could not be loaded"
        message={toUserMessage(adjustment.error)}
        onRetry={() => void adjustment.refetch()}
        className="mt-8"
      />
    );
  }

  if (!adjustment.data) {
    return (
      <EmptyState
        title="Adjustment not found"
        description="This adjustment may have been removed, or the link is incorrect."
        action={
          <Link href="/adjustments" className={buttonClasses({})}>
            Back to adjustments
          </Link>
        }
        className="mt-8"
      />
    );
  }

  const a = adjustment.data;
  const isVoided = a.status === "VOIDED";

  const lineColumns: ResponsiveTableColumn<AdjustmentLineWithProductDto>[] = [
    {
      header: "Product",
      render: (line) =>
        line.productName || line.productId.slice(0, 8),
    },
    {
      header: "Location",
      render: (line) => line.location.replace(/_/g, " "),
    },
    {
      header: "Delta",
      align: "right",
      render: (line) => (
        <span className="tabular">
          {line.quantityDeltaUnits > 0
            ? `+${line.quantityDeltaUnits}`
            : line.quantityDeltaUnits.toString()}
        </span>
      ),
    },
    {
      header: "Unit cost",
      align: "right",
      render: (line) => <Money kobo={line.unitCostKobo} tone="neutral" />,
    },
  ];

  async function tryVoid() {
    if (isVoided) return;
    await confirm({
      title: "Void this adjustment?",
      tone: "danger",
      confirmLabel: "Void adjustment",
      cancelLabel: "Keep adjustment",
      description: "This cannot be undone.",
      details: (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>The stock movements from this adjustment will be reversed.</li>
          <li>Stock levels return to what they were before the adjustment.</li>
          <li>
            The record stays in history marked <strong>VOIDED</strong>.
          </li>
        </ul>
      ),
      onConfirm: () => voidMutation.mutateAsync(),
      successMessage: `Adjustment ${a.id.slice(0, 8)} voided.`,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Adjustment ${a.id.slice(0, 8)}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{formatLagosDateTime(a.adjustedAt)}</span>
            <StatusBadge status={a.status} />
          </span>
        }
        actions={
          <>
            <Link
              href="/adjustments"
              className={buttonClasses({ variant: "secondary" })}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </Link>
            {!isVoided && (
              <Button
                variant="danger"
                loading={voidMutation.isPending}
                disabled={network.offline}
                onClick={() => void tryVoid()}
              >
                <Ban aria-hidden="true" className="h-4 w-4" />
                Void adjustment
              </Button>
            )}
          </>
        }
      />

      {isVoided && (
        <div
          role="status"
          className="rounded-md border border-danger/30 bg-danger-surface p-4 text-sm text-danger"
        >
          <p className="font-semibold">This adjustment is voided</p>
          <p className="mt-1">
            The stock movements were reversed. The record is kept for audit.
          </p>
        </div>
      )}

      <Card>
        <CardBody>
          <p className="text-sm text-muted-foreground">Reason</p>
          <p className="mt-1 font-medium">{a.reason}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lines" />
        <CardBody>
          <ResponsiveTable
            rows={a.lines}
            columns={lineColumns}
            getKey={(line) => line.id}
          />
        </CardBody>
      </Card>
    </div>
  );
}
