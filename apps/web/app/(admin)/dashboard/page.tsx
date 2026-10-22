"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HandCoins,
  Receipt,
  ShoppingCart,
  TrendingDown,
  Wallet,
} from "lucide-react";
import {
  formatNaira,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
} from "@fabtyna/shared";
import { InfoHint } from "@/components/info-hint";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, type StatTrend } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { reportsApi, salesApi, stockApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { REPORT_STALE_MS } from "@/lib/report-range";
import { ReportToolbar } from "@/components/reports/report-toolbar";

const DAY_MS = 24 * 60 * 60 * 1000;

function trendFor(
  current: bigint,
  previous: bigint,
  upIsGood = true,
): StatTrend {
  const diff = current - previous;
  if (diff === 0n) {
    return { direction: "flat", label: "No change vs yesterday", upIsGood };
  }
  const absolute = diff < 0n ? -diff : diff;
  const sign = diff > 0n ? "+" : "\u2212";
  return {
    direction: diff > 0n ? "up" : "down",
    label: `${sign}${formatNaira(absolute)} vs yesterday`,
    upIsGood,
  };
}

export default function DashboardPage() {
  // Real mode shows only what GET /reports/dashboard returns; the demo store still computes locally.
  const mock = isMockApiMode;
  const stock = useQuery({
    queryKey: queryKeys.stock.list,
    queryFn: () => stockApi.list(),
    enabled: mock,
  });
  const sales = useQuery({
    queryKey: queryKeys.sales.list,
    queryFn: () => salesApi.list(),
    enabled: mock,
  });

  // "Today" is the Lagos (Africa/Lagos) business day, not the device day.
  const businessDate = useLagosBusinessDate();
  // `null` follows the current Lagos business day, so it rolls over
  // automatically at Lagos midnight. A value pins a specific past day.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const viewDate = selectedDate ?? businessDate;

  const { start: dayStart } = getLagosBusinessDayRange(viewDate);
  const reportFrom = new Date(dayStart.getTime() - 6 * DAY_MS);
  const isToday = viewDate === businessDate;
  const yesterdayDate = getLagosBusinessDate(
    new Date(dayStart.getTime() - DAY_MS),
  );

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(
      getLagosBusinessDate(reportFrom),
      viewDate,
      null,
    ),
    queryFn: () =>
      reportsApi.salesSummary({
        from: getLagosBusinessDate(reportFrom),
        to: viewDate,
      }),
    enabled: mock,
  });

  const dashboard = useQuery({
    queryKey: queryKeys.reports.dashboard(viewDate),
    queryFn: () => reportsApi.dashboard(viewDate),
    enabled: !mock,
    staleTime: REPORT_STALE_MS,
  });
  const dash = dashboard.data;

  const today = useMemo(
    () => report.data?.days.find((d) => d.date === viewDate) ?? null,
    [report.data, viewDate],
  );
  const yesterday = useMemo(
    () => report.data?.days.find((d) => d.date === yesterdayDate) ?? null,
    [report.data, yesterdayDate],
  );

  const totalRetailWorth = dash
    ? BigInt(dash.stock.worthAtRetailKobo)
    : (stock.data?.reduce((sum, row) => sum + BigInt(row.retailWorthKobo), 0n) ??
      0n);
  const totalWholesaleWorth = dash
    ? BigInt(dash.stock.worthAtWholesaleKobo)
    : (stock.data?.reduce(
        (sum, row) => sum + BigInt(row.wholesaleWorthKobo),
        0n,
      ) ?? 0n);
  const stockCostWorth = dash ? BigInt(dash.stock.worthAtCostKobo) : null;

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

  const big = (value: string | undefined) => BigInt(value ?? "0");

  const retailSupposed = dash
    ? big(dash.channels.RETAIL.supposedKobo)
    : big(today?.retailSupposedRevenueKobo);
  const retailGotten = dash
    ? big(dash.channels.RETAIL.gottenKobo)
    : big(today?.retailRevenueGottenKobo);
  const wholesaleSupposed = dash
    ? big(dash.channels.WHOLESALE.supposedKobo)
    : big(today?.wholesaleSupposedRevenueKobo);
  const wholesaleGotten = dash
    ? big(dash.channels.WHOLESALE.gottenKobo)
    : big(today?.wholesaleRevenueGottenKobo);
  const todayNetProfit = dash
    ? big(dash.metrics.netProfitKobo.value)
    : big(today?.totalNetProfitKobo);
  const todayExpenses = dash
    ? big(dash.metrics.expensesKobo.value)
    : big(today?.totalExpensesKobo);

  const yNetProfit = dash
    ? big(dash.metrics.netProfitKobo.yesterday)
    : big(yesterday?.totalNetProfitKobo);
  const yExpenses = dash
    ? big(dash.metrics.expensesKobo.yesterday)
    : big(yesterday?.totalExpensesKobo);

  const retailDebt = dash
    ? big(dash.channels.RETAIL.debtKobo)
    : outstandingDebt.retail;
  const wholesaleDebt = dash
    ? big(dash.channels.WHOLESALE.debtKobo)
    : outstandingDebt.wholesale;
  const totalDebt = dash ? big(dash.metrics.debtKobo.value) : retailDebt + wholesaleDebt;

  const totalGotten = dash
    ? big(dash.metrics.revenueGottenKobo.value)
    : retailGotten + wholesaleGotten;
  const yTotalGotten = dash
    ? big(dash.metrics.revenueGottenKobo.yesterday)
    : big(yesterday?.retailRevenueGottenKobo) +
      big(yesterday?.wholesaleRevenueGottenKobo);
  const yDebt = dash ? big(dash.metrics.debtKobo.yesterday) : null;

  const isLoading = mock
    ? stock.isPending || report.isPending || sales.isPending
    : dashboard.isPending;
  const isError = mock
    ? stock.isError || report.isError || sales.isError
    : dashboard.isError;
  const activeError = mock
    ? (stock.error ?? report.error ?? sales.error)
    : dashboard.error;
  const refetchAll = () => {
    if (mock) {
      void stock.refetch();
      void report.refetch();
      void sales.refetch();
    } else {
      void dashboard.refetch();
    }
  };
  const breakdownRows: {
    label: string;
    retail: bigint;
    wholesale: bigint;
    isOwed?: boolean;
  }[] = [
    {
      label: "Supposed (billed)",
      retail: retailSupposed,
      wholesale: wholesaleSupposed,
    },
    {
      label: "Gotten (cash collected)",
      retail: retailGotten,
      wholesale: wholesaleGotten,
    },
    {
      label: "Outstanding debt",
      retail: retailDebt,
      wholesale: wholesaleDebt,
      isOwed: true,
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Dashboard"
        description="Business day follows Africa/Lagos time. Pick a date to look back."
        actions={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="business-date">
              Business date
            </label>
            <input
              id="business-date"
              type="date"
              value={viewDate}
              max={businessDate}
              onChange={(event) => {
                if (event.target.value === "") return;
                setSelectedDate(event.target.value);
              }}
              className="min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            {!isToday && (
              <Button variant="secondary" onClick={() => setSelectedDate(null)}>
                Today
              </Button>
            )}
          </div>
        }
      />

      {!mock && (
        <ReportToolbar
          dataUpdatedAt={dashboard.dataUpdatedAt}
          isFetching={dashboard.isFetching}
          onRefresh={refetchAll}
        />
      )}

      {isError ? (
        <ErrorState
          message={toUserMessage(activeError)}
          onRetry={refetchAll}
        />
      ) : isLoading ? (
        <div className="space-y-6">
          <Skeleton variant="stat" count={4} />
          <Skeleton variant="card" count={2} />
        </div>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-section font-semibold text-foreground">
              {isToday ? "Today" : `Day summary: ${viewDate}`}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Revenue gotten"
                icon={Wallet}
                value={
                  <Money
                    kobo={totalGotten}
                    tone="neutral"
                    className="block truncate text-xl font-bold tracking-tight sm:text-2xl md:text-3xl"
                  />
                }
                trend={trendFor(totalGotten, yTotalGotten)}
                hint={
                  <InfoHint label="Explain revenue collected">
                    Cash actually received on this business date, retail and
                    wholesale together.
                  </InfoHint>
                }
              />
              <StatCard
                label="Today's net profit"
                icon={todayNetProfit < 0n ? TrendingDown : ShoppingCart}
                tone={todayNetProfit < 0n ? "danger" : "default"}
                value={
                  <Money
                    kobo={todayNetProfit}
                    className="block truncate text-xl font-bold tracking-tight sm:text-2xl md:text-3xl"
                  />
                }
                trend={trendFor(todayNetProfit, yNetProfit)}
                hint={
                  <InfoHint label="Explain net profit">
                    Only cash actually received counts towards profit — unpaid
                    debts are excluded.
                  </InfoHint>
                }
              />
              <StatCard
                label="Today's expenses"
                icon={Receipt}
                value={
                  <Money
                    kobo={todayExpenses}
                    tone="neutral"
                    className="block truncate text-xl font-bold tracking-tight sm:text-2xl md:text-3xl"
                  />
                }
                trend={trendFor(todayExpenses, yExpenses, false)}
              />
              <StatCard
                label="Debt from this day's sales"
                icon={HandCoins}
                tone={totalDebt > 0n ? "danger" : "default"}
                value={
                  <Money
                    kobo={totalDebt}
                    className="block truncate text-xl font-bold tracking-tight sm:text-2xl md:text-3xl"
                  />
                }
                hint="Unpaid balance for sales made on this date. It clears once those sales are paid."
                trend={yDebt === null ? undefined : trendFor(totalDebt, yDebt, false)}
              />
            </div>
          </section>

          <Card className="w-full overflow-hidden">
            <CardHeader
              title="Retail vs wholesale"
              action={
                <InfoHint label="Explain retail vs wholesale table">
                  <span className="block">
                    Supposed (billed) is what you sold on this business date.
                    Gotten is the cash received on this date.
                  </span>
                  <span className="mt-2 block">
                    Outstanding debt is the current unpaid balance of sales made on
                    this date, so the rows will not always add up.
                  </span>
                </InfoHint>
              }
            />
            <CardBody className="overflow-x-auto p-0 sm:p-6">
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="py-2.5 pl-4 pr-2 text-left font-medium sm:pl-0">
                      {isToday ? "Today" : viewDate}
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-right font-medium">
                      Retail
                    </th>
                    <th scope="col" className="px-2 py-2.5 text-right font-medium">
                      Wholesale
                    </th>
                    <th scope="col" className="py-2.5 pl-2 pr-4 text-right font-medium sm:pr-0">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((row) => {
                    const total = row.retail + row.wholesale;
                    return (
                      <tr
                        key={row.label}
                        className="border-b border-border last:border-0"
                      >
                        <th
                          scope="row"
                          className="py-3 pl-4 pr-2 text-left font-medium text-foreground sm:pl-0"
                        >
                          {row.label}
                        </th>
                        <td className="tabular px-2 py-3 text-right">
                          {row.isOwed ? (
                            <Money kobo={row.retail} />
                          ) : (
                            <Money kobo={row.retail} tone="neutral" />
                          )}
                        </td>
                        <td className="tabular px-2 py-3 text-right">
                          {row.isOwed ? (
                            <Money kobo={row.wholesale} />
                          ) : (
                            <Money kobo={row.wholesale} tone="neutral" />
                          )}
                        </td>
                        <td className="tabular py-3 pl-2 pr-4 text-right font-semibold sm:pr-0">
                          {row.isOwed ? (
                            <Money kobo={total} />
                          ) : (
                            <Money kobo={total} tone="neutral" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card className="w-full overflow-hidden">
            <CardHeader
              title="Stock on hand"
              action={
                <InfoHint label="Explain stock worth">
                  Current value of the stock on hand right now. It does not change
                  with the date picker above.
                </InfoHint>
              }
            />
            <CardBody>
              <p className="mb-3 text-xs text-muted-foreground">
                As of now, not tied to the selected date.
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {stockCostWorth !== null && (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Worth at cost</dt>
                    <dd className="font-medium">
                      <Money kobo={stockCostWorth} tone="neutral" />
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Retail (fridge) worth</dt>
                  <dd className="font-medium">
                    <Money kobo={totalRetailWorth} tone="neutral" />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Wholesale (warehouse) worth</dt>
                  <dd className="font-medium">
                    <Money kobo={totalWholesaleWorth} tone="neutral" />
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}