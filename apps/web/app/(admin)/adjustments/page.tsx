"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { adjustmentsApi } from "@/lib/api";
import { isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { WriteFlowStatus } from "@/components/write-flow-status";
import type { StockAdjustmentDto } from "@fabtyna/shared";

export default function AdjustmentsPage() {
  const [filterDate, setFilterDate] = useState("");
  const businessDate = useLagosBusinessDate();
  const network = useNetworkStatus();
  const queryClient = useQueryClient();
  const writeFlow = useWriteFlow();
  const [lastVoidId, setLastVoidId] = useState("");

  const adjustments = useQuery({
    queryKey: queryKeys.adjustments.list,
    queryFn: () => adjustmentsApi.list(),
  });

  const voidMutation = useMutation({
    mutationFn: async (adjustmentId: string) => {
      if (isMockApiMode) return adjustmentsApi.void(adjustmentId);
      if (writeFlow.status === "unknown" && adjustmentId !== lastVoidId) return undefined;
      if (writeFlow.status === "failed" && adjustmentId !== lastVoidId) writeFlow.edit();
      setLastVoidId(adjustmentId);
      return writeFlow.run((key) => adjustmentsApi.void(adjustmentId, key));
    },
    onSuccess: (result) => {
      if (!result) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.adjustments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const rows = useMemo(() => {
    return (adjustments.data ?? [])
      .filter(
        (a) =>
          filterDate === "" ||
          getLagosBusinessDate(new Date(a.adjustedAt)) === filterDate,
      )
      .sort(
        (a, b) =>
          new Date(b.adjustedAt).getTime() - new Date(a.adjustedAt).getTime(),
      );
  }, [adjustments.data, filterDate]);

  async function tryVoid(a: StockAdjustmentDto) {
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
      onConfirm: () => voidMutation.mutateAsync(a.id),
    });
  }

  const columns: ResponsiveTableColumn<StockAdjustmentDto>[] = [
    {
      header: "Date",
      render: (a) => formatLagosDate(a.adjustedAt),
    },
    {
      header: "Reason",
      render: (a) => a.reason,
    },
    {
      header: "Status",
      render: (a) => <StatusBadge status={a.status} />,
    },
    {
      header: "Actions",
      align: "right",
      render: (a) => (
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/adjustments/${a.id}`}
            className="font-medium text-primary hover:underline"
          >
            View
          </Link>
          {a.status === "COMPLETED" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10"
              loading={
                voidMutation.isPending && voidMutation.variables === a.id
              }
              disabled={voidMutation.isPending || network.offline || writeFlow.status === "unknown"}
              onClick={() => void tryVoid(a)}
            >
              <Ban aria-hidden="true" className="h-3.5 w-3.5" />
              Void
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Adjustments"
        description="Correct stock counts for damaged, lost or found items."
        actions={
          <Link href="/adjustments/new" className={buttonClasses({ size: "md" })}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New adjustment
          </Link>
        }
      />
      <WriteFlowStatus
        flow={writeFlow}
        onRetry={() => {
          if (lastVoidId) voidMutation.mutate(lastVoidId);
        }}
        checkHref="/adjustments"
        checkLabel="Check adjustments"
        showFieldErrors
      />

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter
            id="adjustments-date"
            value={filterDate}
            onChange={setFilterDate}
            max={businessDate}
          />
        </div>

        {adjustments.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : adjustments.isError ? (
          <ErrorState
            title="Adjustments could not be loaded"
            message={toUserMessage(adjustments.error)}
            onRetry={() => void adjustments.refetch()}
          />
        ) : rows.length === 0 ? (
          filterDate !== "" ? (
            <EmptyState
              title="No adjustments match these filters"
              description="Try clearing the date filter."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilterDate("")}
                >
                  Clear filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Scale}
              title="No adjustments yet"
              description="Record a correction when stock counts change for damage, loss or found items."
              action={
                <Link
                  href="/adjustments/new"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  New adjustment
                </Link>
              }
            />
          )
        ) : (
          <ResponsiveTable rows={rows} columns={columns} getKey={(a) => a.id} />
        )}
      </section>
    </div>
  );
}
