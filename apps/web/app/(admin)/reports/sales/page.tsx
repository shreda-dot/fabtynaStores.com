"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { reportsApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SalesSummaryDayDto } from "@/lib/api/reports.api";

function toDateInput(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function SalesReportPage() {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState<string>(toDateInput(sevenDaysAgo));
  const [to, setTo] = useState<string>(toDateInput(today));

  const fromDate = new Date(`${from}T00:00:00+01:00`);
  const toDate = new Date(`${to}T23:59:59+01:00`);

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(from, to),
    queryFn: () => reportsApi.salesSummary(fromDate, toDate),
  });

  const columns: ResponsiveTableColumn<SalesSummaryDayDto>[] = [
    {
      header: "Date",
      render: (day) => new Date(day.date).toLocaleDateString("en-NG"),
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
              <p className="text-xs text-muted-foreground">Supposed revenue</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNaira(totals?.totalSupposedRevenueKobo ?? "0")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Revenue gotten</p>
              <p className="mt-1 text-xl font-semibold">
                {formatNaira(totals?.totalRevenueGottenKobo ?? "0")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Outstanding debt</p>
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
            <h2 className="text-lg font-semibold">
              Why doesn&apos;t it tally?
            </h2>
            <p className="text-sm text-muted-foreground">
              Supposed revenue is what you billed. Revenue gotten is cash
              received. Here is where the gap went.
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-4">
                <span>
                  Outstanding debts (supposed minus gotten)
                </span>
                <span
                  className={`font-medium ${
                    debt > 0n ? "text-destructive" : ""
                  }`}
                >
                  {formatNaira(debt.toString())}
                </span>
              </li>
              <li className="flex items-center justify-between gap-4">
                <span>
                  Discounts given (standard price minus supposed)
                </span>
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
            {report.data!.days.length === 0 ? (
              <ListEmpty message="No sales in this period." />
            ) : (
              <ResponsiveTable
                rows={report.data!.days}
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
