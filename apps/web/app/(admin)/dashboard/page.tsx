"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatNaira,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
} from "@fabtyna/shared";
import { ListLoading } from "@/components/list-feedback";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { reportsApi, salesApi, stockApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function DashboardPage() {
  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
  });
  const sales = useQuery({
    queryKey: queryKeys.sales.list,
    queryFn: () => salesApi.list(),
  });

  // "Today" is the Lagos (Africa/Lagos) business day, not the device day.
  const businessDate = useLagosBusinessDate();
  // `null` follows the current Lagos business day, so it rolls over
  // automatically at Lagos midnight. A value pins a specific past day.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const viewDate = selectedDate ?? businessDate;

  const { start: dayStart, end: dayEnd } = getLagosBusinessDayRange(viewDate);
  const reportFrom = new Date(dayStart.getTime() - 6 * DAY_MS);
  const isToday = viewDate === businessDate;

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(
      getLagosBusinessDate(reportFrom),
      getLagosBusinessDate(new Date(dayEnd.getTime() - 1)),
    ),
    queryFn: () => reportsApi.salesSummary(reportFrom, dayEnd),
  });

  const today = useMemo(
    () => report.data?.days.find((d) => d.date === viewDate) ?? null,
    [report.data, viewDate],
  );

  const totalRetailWorth =
    stock.data?.reduce((sum, row) => sum + BigInt(row.retailWorthKobo), 0n) ??
    0n;
  const totalWholesaleWorth =
    stock.data?.reduce(
      (sum, row) => sum + BigInt(row.wholesaleWorthKobo),
      0n,
    ) ?? 0n;

  const outstandingDebt = useMemo(() => {
    let retail = 0n;
    let wholesale = 0n;
    for (const sale of sales.data ?? []) {
      if (sale.status === "VOIDED") continue;
      if (getLagosBusinessDate(new Date(sale.soldAt)) !== viewDate) continue;
      const owed = BigInt(sale.totalKobo) - BigInt(sale.paidKobo);
      if (owed <= 0n) continue;
      if (sale.channel === "RETAIL") {
        retail += owed;
      } else {
        wholesale += owed;
      }
    }
    return { retail, wholesale };
  }, [sales.data, viewDate]);

  const retailSupposed = BigInt(today?.retailSupposedRevenueKobo ?? "0");
  const retailGotten = BigInt(today?.retailRevenueGottenKobo ?? "0");
  const wholesaleSupposed = BigInt(today?.wholesaleSupposedRevenueKobo ?? "0");
  const wholesaleGotten = BigInt(today?.wholesaleRevenueGottenKobo ?? "0");
  const todayNetProfit = BigInt(today?.totalNetProfitKobo ?? "0");
  const todayExpenses = BigInt(today?.totalExpensesKobo ?? "0");
  const retailDebt = outstandingDebt.retail;
  const wholesaleDebt = outstandingDebt.wholesale;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Business day is based on Africa/Lagos time and resets at Lagos
            midnight. Accounts are usually reviewed the next day — pick a date
            to look back.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label
              htmlFor="business-date"
              className="block text-xs font-medium text-muted-foreground"
            >
              Business date
            </label>
            <input
              id="business-date"
              type="date"
              value={viewDate}
              max={businessDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {stock.isPending || report.isPending || sales.isPending ? (
        <ListLoading />
      ) : (
        <div className="space-y-6">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">
              {isToday ? "Today's sales" : `Sales for ${viewDate}`}
            </h2>
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
              <p className="text-sm text-muted-foreground">
                {isToday ? "Today's net profit" : "Net profit"}
              </p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  todayNetProfit < 0n ? "text-destructive" : ""
                }`}
              >
                {formatNaira(todayNetProfit.toString())}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">
                {isToday ? "Today's expenses" : "Expenses"}
              </p>
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
              received on that day. Outstanding debt below shows the current
              unpaid balance for sales from this business date. The gap is made
              up of unpaid debts, discounts given below the standard price, and
              expenses.
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
