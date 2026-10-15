"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@fabtyna/shared";
import { ListLoading } from "@/components/list-feedback";
import { reportsApi, stockApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

function startOfLagosDay(date: Date): Date {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00+01:00`);
}

export default function DashboardPage() {
  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });

  const now = new Date();
  const todayStart = startOfLagosDay(now);
  const reportTo = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const reportFrom = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const todayStr = todayStart.toISOString().slice(0, 10);

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(
      reportFrom.toISOString().slice(0, 10),
      reportTo.toISOString().slice(0, 10),
    ),
    queryFn: () => reportsApi.salesSummary(reportFrom, reportTo),
  });

  const today = useMemo(
    () => report.data?.days.find((d) => d.date === todayStr) ?? null,
    [report.data, todayStr],
  );

  const totalRetailWorth = stock.data?.reduce(
    (sum, row) => sum + BigInt(row.retailWorthKobo),
    0n,
  ) ?? 0n;
  const totalWholesaleWorth = stock.data?.reduce(
    (sum, row) => sum + BigInt(row.wholesaleWorthKobo),
    0n,
  ) ?? 0n;

  const retailSupposed = BigInt(today?.retailSupposedRevenueKobo ?? "0");
  const retailGotten = BigInt(today?.retailRevenueGottenKobo ?? "0");
  const wholesaleSupposed = BigInt(today?.wholesaleSupposedRevenueKobo ?? "0");
  const wholesaleGotten = BigInt(today?.wholesaleRevenueGottenKobo ?? "0");
  const todayNetProfit = BigInt(today?.totalNetProfitKobo ?? "0");
  const todayExpenses = BigInt(today?.totalExpensesKobo ?? "0");
  const retailDebt = retailSupposed - retailGotten;
  const wholesaleDebt = wholesaleSupposed - wholesaleGotten;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fabtyna Stores administration.
        </p>
      </div>

      {stock.isPending || report.isPending ? (
        <ListLoading />
      ) : (
        <div className="space-y-6">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Today&apos;s sales</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-base font-medium">Retail (fridge)</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Stock worth</dt>
                    <dd className="font-medium">
                      {formatNaira(totalRetailWorth.toString())}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Supposed revenue</dt>
                    <dd className="font-medium">
                      {formatNaira(retailSupposed.toString())}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Revenue gotten</dt>
                    <dd className="font-medium">
                      {formatNaira(retailGotten.toString())}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Outstanding debt</dt>
                    <dd
                      className={`font-medium ${
                        retailDebt > 0n ? "text-destructive" : ""
                      }`}
                    >
                      {formatNaira(retailDebt.toString())}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-base font-medium">Wholesale (warehouse)</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Stock worth</dt>
                    <dd className="font-medium">
                      {formatNaira(totalWholesaleWorth.toString())}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Supposed revenue</dt>
                    <dd className="font-medium">
                      {formatNaira(wholesaleSupposed.toString())}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Revenue gotten</dt>
                    <dd className="font-medium">
                      {formatNaira(wholesaleGotten.toString())}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Outstanding debt</dt>
                    <dd
                      className={`font-medium ${
                        wholesaleDebt > 0n ? "text-destructive" : ""
                      }`}
                    >
                      {formatNaira(wholesaleDebt.toString())}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">Today&rsquo;s net profit</p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  todayNetProfit < 0n ? "text-destructive" : ""
                }`}
              >
                {formatNaira(todayNetProfit.toString())}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">Today&rsquo;s expenses</p>
              <p className="mt-2 text-2xl font-semibold">
                {formatNaira(todayExpenses.toString())}
              </p>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">
              Why doesn&rsquo;t it tally?
            </h2>
            <p className="text-sm text-muted-foreground">
              Supposed revenue is what was billed. Revenue gotten is cash
              received today. The gap is made up of unpaid debts, discounts
              given below the standard price, and expenses.
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-4">
                <span>Retail debts</span>
                <span
                  className={`font-medium ${
                    retailDebt > 0n ? "text-destructive" : ""
                  }`}
                >
                  {formatNaira(retailDebt.toString())}
                </span>
              </li>
              <li className="flex items-center justify-between gap-4">
                <span>Wholesale debts</span>
                <span
                  className={`font-medium ${
                    wholesaleDebt > 0n ? "text-destructive" : ""
                  }`}
                >
                  {formatNaira(wholesaleDebt.toString())}
                </span>
              </li>
              <li className="flex items-center justify-between gap-4">
                <span>Expenses</span>
                <span className="font-medium">
                  {formatNaira(todayExpenses.toString())}
                </span>
              </li>
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">
              Visit the Debtors page to see who still owes, and the Sales report
              for the full breakdown.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
