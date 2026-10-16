"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Plus, Users } from "lucide-react";
import Link from "next/link";
import {
  formatLagosDate,
  formatNaira,
  getLagosBusinessDate,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { MoneyInput } from "@/components/money-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { salesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import type { SaleDetailDto, SaleListItemDto } from "@/lib/api/sales.api";

type DebtorSale = SaleDetailDto & {
  amountOwedKobo: bigint;
};

type DebtorGroup = {
  customerId: string;
  customerName: string;
  totalOwedKobo: bigint;
  latestSoldAt: number;
  sales: DebtorSale[];
};

function amountOwed(
  sale: Pick<SaleListItemDto, "totalKobo" | "paidKobo">,
): bigint {
  return BigInt(sale.totalKobo) - BigInt(sale.paidKobo);
}

function compareAmountDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

export default function DebtorsPage() {
  const queryClient = useQueryClient();

  const [filterDate, setFilterDate] = useState("");
  const businessDate = useLagosBusinessDate();

  const salesQuery = useQuery({
    queryKey: queryKeys.sales.list,
    queryFn: () => salesApi.list(),
  });

  const unpaidSales = useMemo(() => {
    return (salesQuery.data ?? []).filter(
      (s) =>
        s.status !== "VOIDED" &&
        amountOwed(s) > 0n &&
        (filterDate === "" ||
          getLagosBusinessDate(new Date(s.soldAt)) === filterDate),
    );
  }, [salesQuery.data, filterDate]);

  const unpaidIds = unpaidSales.map((s) => s.id).join(",");

  const detailsQuery = useQuery({
    queryKey: ["sales", "debtor-details", unpaidIds],
    queryFn: async () => {
      const details = await Promise.all(
        unpaidSales.map((s) => salesApi.getById(s.id)),
      );
      return details;
    },
    enabled: unpaidSales.length > 0,
  });

  const debtorGroups = useMemo<DebtorGroup[]>(() => {
    const details = detailsQuery.data ?? [];
    const map = new Map<string, DebtorGroup>();
    for (const detail of details) {
      const owed = BigInt(detail.totalKobo) - BigInt(detail.paidKobo);
      if (owed <= 0n) continue;
      const groupKey =
        detail.customer?.id ?? `adhoc:${detail.customerName ?? detail.id}`;
      const displayName =
        detail.customer?.name ?? detail.customerName ?? "Walk-in";
      const soldAtMs = new Date(detail.soldAt).getTime();
      const existing = map.get(groupKey);
      const debtorSale: DebtorSale = { ...detail, amountOwedKobo: owed };
      if (existing) {
        existing.totalOwedKobo += owed;
        existing.latestSoldAt = Math.max(existing.latestSoldAt, soldAtMs);
        existing.sales.push(debtorSale);
      } else {
        map.set(groupKey, {
          customerId: groupKey,
          customerName: displayName,
          totalOwedKobo: owed,
          latestSoldAt: soldAtMs,
          sales: [debtorSale],
        });
      }
    }
    const groups = [...map.values()];
    for (const group of groups) {
      group.sales.sort(
        (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime(),
      );
    }
    // Largest debt first so the biggest exposure is always on top.
    return groups.sort((a, b) =>
      compareAmountDesc(a.totalOwedKobo, b.totalOwedKobo),
    );
  }, [detailsQuery.data]);

  const [payingSaleId, setPayingSaleId] = useState<string | null>(null);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const submitting = useRef(false);

  const payMutation = useMutation({
    mutationFn: ({
      saleId,
      amountKobo,
    }: {
      saleId: string;
      amountKobo: string;
    }) => salesApi.recordPayment(saleId, amountKobo, new Date().toISOString()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.customers.all,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      setPayingSaleId(null);
      setPaymentKobo("");
      setPaymentError("");
    },
  });

  function startPayment(saleId: string, owed: bigint) {
    setPayingSaleId(saleId);
    setPaymentKobo(owed.toString());
    setPaymentError("");
  }

  async function submitPayment(sale: DebtorSale, groupName: string) {
    if (submitting.current || payMutation.isPending) return;
    setPaymentError("");

    if (paymentKobo.trim() === "" || !/^[0-9]+$/.test(paymentKobo)) {
      setPaymentError("Enter a valid amount.");
      return;
    }
    const amount = BigInt(paymentKobo);
    const owed = sale.amountOwedKobo;
    if (amount <= 0n) {
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    if (amount > owed) {
      setPaymentError(
        `Payment cannot be more than the outstanding balance of ${formatNaira(owed)}.`,
      );
      return;
    }

    const remaining = owed - amount;
    const clearsDebt = remaining === 0n;

    submitting.current = true;
    try {
      await confirm({
        title: "Record this payment?",
        description: "Confirm before the payment is saved.",
        confirmLabel: "Record payment",
        successMessage: `Payment of ${formatNaira(amount)} recorded for ${groupName}.`,
        details: (
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="font-medium text-foreground">{groupName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium text-foreground">
                <Money kobo={amount} tone="neutral" />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Remaining balance</dt>
              <dd className="font-medium text-foreground">
                <Money kobo={remaining} />
              </dd>
            </div>
            {clearsDebt && (
              <p className="rounded-sm border border-success/30 bg-success-surface px-2 py-1 text-xs text-success">
                This will clear the debt.
              </p>
            )}
          </dl>
        ),
        onConfirm: () =>
          payMutation.mutateAsync({
            saleId: sale.id,
            amountKobo: paymentKobo,
          }),
      });
    } finally {
      submitting.current = false;
    }
  }

  const totalOwed = debtorGroups.reduce((sum, g) => sum + g.totalOwedKobo, 0n);
  const unpaidCount = debtorGroups.reduce((sum, g) => sum + g.sales.length, 0);

  const isLoading = salesQuery.isLoading || detailsQuery.isLoading;
  const isError = salesQuery.isError || detailsQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Debtors"
        description="Customers and walk-ins who owe money from unpaid sales."
        actions={
          <Link
            href="/sales"
            className={buttonClasses({ variant: "secondary" })}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New sale
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total outstanding"
          value={<Money kobo={totalOwed} tone="auto" />}
          tone={totalOwed > 0n ? "danger" : "default"}
          icon={HandCoins}
        />
        <StatCard
          label="Customers owing"
          value={debtorGroups.length}
          icon={Users}
        />
        <StatCard label="Unpaid sales" value={unpaidCount} />
      </div>

      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter
            id="f-date"
            value={filterDate}
            onChange={setFilterDate}
            max={businessDate}
          />
        </CardBody>
      </Card>

      {isLoading ? (
        <Skeleton variant="row" count={4} />
      ) : isError ? (
        <ErrorState
          message={toUserMessage(salesQuery.error ?? detailsQuery.error)}
          onRetry={() => {
            void salesQuery.refetch();
            void detailsQuery.refetch();
          }}
        />
      ) : debtorGroups.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No outstanding debts"
          description="Every sale on record is fully paid."
          action={
            <Link
              href="/sales"
              className={buttonClasses({ variant: "secondary" })}
            >
              View sales
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {debtorGroups.map((group) => (
            <Card key={group.customerId}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-section font-semibold text-card-foreground">
                    {group.customerName}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {group.sales.length === 1
                      ? "1 unpaid sale"
                      : `${group.sales.length} unpaid sales`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total owed</p>
                  <p className="text-lg font-bold text-danger">
                    <Money kobo={group.totalOwedKobo} />
                  </p>
                </div>
              </div>

              <CardBody className="space-y-3">
                {group.sales.map((sale) => {
                  const channelLabel =
                    sale.channel === "RETAIL" ? "Retail" : "Wholesale";
                  const isPaying = payingSaleId === sale.id;
                  return (
                    <div
                      key={sale.id}
                      className="rounded-md border border-border bg-background/50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-medium text-foreground">
                            {channelLabel}
                          </span>
                          <span className="text-muted-foreground">
                            {" · "}
                            {formatLagosDate(sale.soldAt)}
                          </span>
                        </div>
                        <div className="text-sm">
                          <Money
                            kobo={sale.amountOwedKobo}
                            className="font-medium"
                          />
                          <span className="text-muted-foreground">
                            {" of "}
                            <Money kobo={sale.totalKobo} tone="neutral" />
                          </span>
                        </div>
                      </div>

                      <p className="mt-2 text-sm text-muted-foreground">
                        {sale.lines
                          .map((l) => `${l.productName} ×${l.quantity}`)
                          .join(", ")}
                      </p>

                      {isPaying ? (
                        <div className="mt-3 space-y-3">
                          <MoneyInput
                            id={`pay-${sale.id}`}
                            label="Payment amount"
                            defaultValueKobo={sale.amountOwedKobo.toString()}
                            onKoboChange={setPaymentKobo}
                          />
                          {paymentError && (
                            <p role="alert" className="text-sm text-danger">
                              {paymentError}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() =>
                                void submitPayment(sale, group.customerName)
                              }
                              loading={payMutation.isPending}
                            >
                              <HandCoins
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                              Confirm payment
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setPayingSaleId(null);
                                setPaymentError("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3 border-primary text-primary hover:bg-primary/10"
                          onClick={() =>
                            startPayment(sale.id, sale.amountOwedKobo)
                          }
                        >
                          Record payment
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
