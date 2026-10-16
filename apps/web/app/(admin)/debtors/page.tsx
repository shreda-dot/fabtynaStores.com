"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import {
  formatLagosDate,
  formatNaira,
  getLagosBusinessDate,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { MoneyInput } from "@/components/money-input";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { salesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
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
    return groups.sort((a, b) => b.latestSoldAt - a.latestSoldAt);
  }, [detailsQuery.data]);

  const [payingSaleId, setPayingSaleId] = useState<string | null>(null);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentError, setPaymentError] = useState("");

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

  function submitPayment(saleId: string) {
    setPaymentError("");
    if (!paymentKobo) {
      setPaymentError("Enter an amount.");
      return;
    }
    payMutation.mutate({ saleId, amountKobo: paymentKobo });
  }

  const totalOwed = debtorGroups.reduce((sum, g) => sum + g.totalOwedKobo, 0n);

  const isLoading = salesQuery.isLoading || detailsQuery.isLoading;
  const isError = salesQuery.isError || detailsQuery.isError;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Debtors</h1>
        <p className="text-sm text-muted-foreground">
          Customers who owe money from unpaid sales
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Total Outstanding</div>
          <div className="text-2xl font-bold">{formatNaira(totalOwed)}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Customers Owing</div>
          <div className="text-2xl font-bold">{debtorGroups.length}</div>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <DateFilter
          id="f-date"
          value={filterDate}
          onChange={setFilterDate}
          max={businessDate}
        />
      </div>

      {isLoading ? (
        <ListLoading />
      ) : isError ? (
        <ListError
          message="Could not load debtors."
          retry={() => void salesQuery.refetch()}
        />
      ) : debtorGroups.length === 0 ? (
        <ListEmpty message="All customer sales are fully paid." />
      ) : (
        <div className="space-y-4">
          {debtorGroups.map((group) => (
            <div
              key={group.customerId}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {group.customerName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Total owed: {formatNaira(group.totalOwedKobo)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {group.sales.map((sale) => {
                  const channelLabel =
                    sale.channel === "RETAIL" ? "Retail" : "Wholesale";
                  return (
                    <div
                      key={sale.id}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-medium">{channelLabel}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {formatLagosDate(sale.soldAt)}
                          </span>
                        </div>
                        <div className="text-sm font-medium">
                          {formatNaira(sale.amountOwedKobo)}{" "}
                          <span className="text-muted-foreground">
                            of {formatNaira(sale.totalKobo)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 text-sm text-muted-foreground">
                        {sale.lines
                          .map((l) => `${l.productName} ×${l.quantity}`)
                          .join(", ")}
                      </div>

                      {payingSaleId === sale.id ? (
                        <div className="mt-3 space-y-3">
                          <MoneyInput
                            id={`pay-${sale.id}`}
                            label="Payment amount"
                            defaultValueKobo={sale.amountOwedKobo.toString()}
                            onKoboChange={setPaymentKobo}
                          />
                          {paymentError && (
                            <p
                              role="alert"
                              className="text-sm text-destructive"
                            >
                              {paymentError}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => submitPayment(sale.id)}
                              disabled={payMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Confirm Payment
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPayingSaleId(null);
                                setPaymentError("");
                              }}
                              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            startPayment(sale.id, sale.amountOwedKobo)
                          }
                          className="mt-3 rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                        >
                          Record Payment
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
