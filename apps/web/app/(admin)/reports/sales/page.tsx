"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatLagosDate,
  formatNaira,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
} from "@fabtyna/shared";
import { InfoHint } from "@/components/info-hint";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { reportsApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SalesSummaryDayDto } from "@/lib/api/reports.api";

export default function SalesReportPage() {
  const today = getLagosBusinessDate();
  const { start: todayStart } = getLagosBusinessDayRange(today);
  const sevenDaysAgo = getLagosBusinessDate(
    new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000),
  );

  const [from, setFrom] = useState<string>(sevenDaysAgo);
  const [to, setTo] = useState<string>(today);

  const fromDate = new Date(`${from}T00:00:00+01:00`);
  const toDate = new Date(`${to}T23:59:59+01:00`);

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(from, to),
    queryFn: () => reportsApi.salesSummary(fromDate, toDate),
  });
  const days = useMemo(
    () =>
      [...(report.data?.days ?? [])].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
    [report.data?.days],
  );

  const columns: ResponsiveTableColumn<SalesSummaryDayDto>[] = [
    {
      header: "Date",
      render: (day) => formatLagosDate(day.date),
    },
    {
      header: "Retail supposed",
      render: (day) => formatNaira(day.retailSupposedRevenueKobo),
    },
    {
      header: "Retail gotten",
      render: (day) => formatNaira(day.retailRevenueGottenKobo),
    },
    {
      header: "Retail net",
      render: (day) => (
        <span
          className={
            BigInt(day.retailNetProfitKobo) < 0n ? "text-destructive" : ""
          }
        >
          {formatNaira(day.retailNetProfitKobo)}
        </span>
      ),
    },
    {
      header: "Wholesale supposed",
      render: (day) => formatNaira(day.wholesaleSupposedRevenueKobo),
    },
    {
      header: "Wholesale gotten",
      render: (day) => formatNaira(day.wholesaleRevenueGottenKobo),
    },
    {
      header: "Wholesale net",
      render: (day) => (
        <span
          className={
            BigInt(day.wholesaleNetProfitKobo) < 0n ? "text-destructive" : ""
          }
        >
          {formatNaira(day.wholesaleNetProfitKobo)}
        </span>
      ),
    },
    {
      header: "Total net",
      render: (day) => (
        <span
          className={`font-medium ${
            BigInt(day.totalNetProfitKobo) < 0n ? "text-destructive" : ""
          }`}
        >
          {formatNaira(day.totalNetProfitKobo)}
        </span>
      ),
    },
  ];

  const totals = report.data?.totals;
  const supposed = BigInt(totals?.totalSupposedRevenueKobo ?? "0");
  const gotten = BigInt(totals?.totalRevenueGottenKobo ?? "0");
  const standard = BigInt(totals?.totalStandardRevenueKobo ?? "0");
  const expenses = BigInt(totals?.totalExpensesKobo ?? "0");
  const debt = supposed - gotten;
  const discount = standard - supposed;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Revenue, cost of goods sold and gross profit by day and channel.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="from" className="block text-sm font-medium">
              From
            </label>
            <input
              id="from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="to" className="block text-sm font-medium">
              To
            </label>
            <input
              id="to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            />
          </div>
        </div>
      </section>

      {report.isPending ? (
        <ListLoading />
      ) : report.isError ? (
        <ListError
          message={report.error.message || "Report could not be loaded."}
          retry={() => void report.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                Supposed revenue
                <InfoHint label="Explain supposed revenue" align="right">
                  This is what you billed on the sale date.
                </InfoHint>
              </p>
              <p className="mt-1 text-xl font-semibold">
                {formatNaira(totals?.totalSupposedRevenueKobo ?? "0")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                Revenue gotten
                <InfoHint label="Explain revenue gotten" align="right">
                  This is cash actually received in the selected period. If an
                  old debt is paid today, it shows here today.
                </InfoHint>
              </p>
              <p className="mt-1 text-xl font-semibold">
                {formatNaira(totals?.totalRevenueGottenKobo ?? "0")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                Outstanding debt
                <InfoHint label="Explain outstanding debt" align="right">
                  This is billed revenue that has not been collected yet in the
                  selected period.
                </InfoHint>
              </p>
              <p
                className={`mt-1 text-xl font-semibold ${
                  debt > 0n ? "text-destructive" : ""
                }`}
              >
                {formatNaira(debt.toString())}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Gross profit</p>
              <p
                className={`mt-1 text-xl font-semibold ${
                  BigInt(totals?.totalGrossProfitKobo ?? "0") < 0n
                    ? "text-destructive"
                    : ""
                }`}
              >
                {formatNaira(totals?.totalGrossProfitKobo ?? "0")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total expenses</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNaira(totals?.totalExpensesKobo ?? "0")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Net profit</p>
              <p
                className={`mt-1 text-xl font-semibold ${
                  BigInt(totals?.totalNetProfitKobo ?? "0") < 0n
                    ? "text-destructive"
                    : ""
                }`}
              >
                {formatNaira(totals?.totalNetProfitKobo ?? "0")}
              </p>
            </div>
          </div>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              Why doesn&apos;t it tally?
              <InfoHint label="Explain why the report may not tally">
                <span className="block">
                  `Supposed revenue` is what you billed. `Revenue gotten` is the
                  cash collected in this date range.
                </span>
                <span className="mt-2 block">
                  The numbers differ when customers still owe, when old debts
                  are paid later, or when you sell below your normal price.
                </span>
                <span className="mt-2 block">
                  `Discounts given` means the app thinks your billed price is
                  below your normal selling worth.
                </span>
              </InfoHint>
            </h2>
            <p className="text-sm text-muted-foreground">
              This section shows where the difference between billed value and
              cash received came from.
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-4">
                <span>Outstanding debts (supposed minus gotten)</span>
                <span
                  className={`font-medium ${
                    debt > 0n ? "text-destructive" : ""
                  }`}
                >
                  {formatNaira(debt.toString())}
                </span>
              </li>
              <li className="flex items-center justify-between gap-4">
                <span>Discounts given (standard price minus supposed)</span>
                <span
                  className={`font-medium ${
                    discount > 0n ? "text-destructive" : ""
                  }`}
                >
                  {formatNaira(discount.toString())}
                </span>
              </li>
              <li className="flex items-center justify-between gap-4">
                <span>Expenses</span>
                <span className="font-medium">
                  {formatNaira(expenses.toString())}
                </span>
              </li>
            </ul>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Daily breakdown</h2>
            {days.length === 0 ? (
              <ListEmpty message="No sales in this period." />
            ) : (
              <ResponsiveTable
                rows={days}
                columns={columns}
                getKey={(day) => day.date}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
