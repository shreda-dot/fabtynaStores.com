"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  formatLagosDate,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
} from "@fabtyna/shared";
import { InfoHint } from "@/components/info-hint";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { reportsApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { SalesSummaryDayDto } from "@/lib/api/reports.api";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats a kobo integer string as a plain decimal string for CSV export. */
function koboToDecimal(kobo: string): string {
  const value = BigInt(kobo || "0");
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function SalesReportPage() {
  const businessDate = useLagosBusinessDate();
  const { start: todayStart } = getLagosBusinessDayRange(businessDate);
  const yesterday = getLagosBusinessDate(
    new Date(todayStart.getTime() - DAY_MS),
  );
  const sevenDaysAgo = getLagosBusinessDate(
    new Date(todayStart.getTime() - 6 * DAY_MS),
  );

  const [from, setFrom] = useState<string>(sevenDaysAgo);
  const [to, setTo] = useState<string>(businessDate);

  const rangeInvalid = from > to;

  const fromDate = new Date(`${from}T00:00:00+01:00`);
  const toDate = new Date(`${to}T23:59:59+01:00`);

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(from, to),
    queryFn: () => reportsApi.salesSummary(fromDate, toDate),
    enabled: !rangeInvalid,
  });

  const days = useMemo(
    () =>
      [...(report.data?.days ?? [])].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
    [report.data?.days],
  );

  const columns: ResponsiveTableColumn<SalesSummaryDayDto>[] = [
    { header: "Date", render: (day) => formatLagosDate(day.date) },
    {
      header: "Retail supposed",
      align: "right",
      render: (day) => (
        <Money kobo={day.retailSupposedRevenueKobo} tone="neutral" />
      ),
    },
    {
      header: "Retail gotten",
      align: "right",
      render: (day) => (
        <Money kobo={day.retailRevenueGottenKobo} tone="neutral" />
      ),
    },
    {
      header: "Retail net",
      align: "right",
      render: (day) => <Money kobo={day.retailNetProfitKobo} />,
    },
    {
      header: "Wholesale supposed",
      align: "right",
      render: (day) => (
        <Money kobo={day.wholesaleSupposedRevenueKobo} tone="neutral" />
      ),
    },
    {
      header: "Wholesale gotten",
      align: "right",
      render: (day) => (
        <Money kobo={day.wholesaleRevenueGottenKobo} tone="neutral" />
      ),
    },
    {
      header: "Wholesale net",
      align: "right",
      render: (day) => <Money kobo={day.wholesaleNetProfitKobo} />,
    },
    {
      header: "Total net",
      align: "right",
      render: (day) => (
        <Money kobo={day.totalNetProfitKobo} className="font-semibold" />
      ),
    },
  ];

  const totals = report.data?.totals;
  const supposed = BigInt(totals?.totalSupposedRevenueKobo ?? "0");
  const gotten = BigInt(totals?.totalRevenueGottenKobo ?? "0");
  const standard = BigInt(totals?.totalStandardRevenueKobo ?? "0");
  const expenses = BigInt(totals?.totalExpensesKobo ?? "0");
  const grossProfit = BigInt(totals?.totalGrossProfitKobo ?? "0");
  const netProfit = BigInt(totals?.totalNetProfitKobo ?? "0");
  const debt = supposed - gotten;
  const discount = standard - supposed;

  function exportCsv() {
    const header = [
      "Date",
      "Retail supposed",
      "Retail gotten",
      "Retail net",
      "Wholesale supposed",
      "Wholesale gotten",
      "Wholesale net",
      "Total net",
    ];
    const rows = days.map((day) => [
      day.date,
      koboToDecimal(day.retailSupposedRevenueKobo),
      koboToDecimal(day.retailRevenueGottenKobo),
      koboToDecimal(day.retailNetProfitKobo),
      koboToDecimal(day.wholesaleSupposedRevenueKobo),
      koboToDecimal(day.wholesaleRevenueGottenKobo),
      koboToDecimal(day.wholesaleNetProfitKobo),
      koboToDecimal(day.totalNetProfitKobo),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvCell(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sales-report-${from}-to-${to}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales report"
        description="Revenue, cost of goods sold and gross profit by day and channel."
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={
                from === businessDate && to === businessDate
                  ? "primary"
                  : "secondary"
              }
              size="sm"
              onClick={() => {
                setFrom(businessDate);
                setTo(businessDate);
              }}
            >
              Today
            </Button>
            <Button
              variant={
                from === yesterday && to === yesterday ? "primary" : "secondary"
              }
              size="sm"
              onClick={() => {
                setFrom(yesterday);
                setTo(yesterday);
              }}
            >
              Yesterday
            </Button>
            <Button
              variant={
                from === sevenDaysAgo && to === businessDate
                  ? "primary"
                  : "secondary"
              }
              size="sm"
              onClick={() => {
                setFrom(sevenDaysAgo);
                setTo(businessDate);
              }}
            >
              Last 7 days
            </Button>
            <Button
              variant={
                from === `${businessDate.slice(0, 7)}-01` && to === businessDate
                  ? "primary"
                  : "secondary"
              }
              size="sm"
              onClick={() => {
                setFrom(`${businessDate.slice(0, 7)}-01`);
                setTo(businessDate);
              }}
            >
              This month
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="from"
              label="From"
              error={
                rangeInvalid
                  ? "The start date must be before the end date."
                  : undefined
              }
            >
              <Input
                id="from"
                type="date"
                value={from}
                max={businessDate}
                aria-invalid={rangeInvalid}
                onChange={(event) => setFrom(event.target.value)}
              />
            </FormField>
            <FormField
              id="to"
              label="To"
              error={
                rangeInvalid
                  ? "The end date must be after the start date."
                  : undefined
              }
            >
              <Input
                id="to"
                type="date"
                value={to}
                max={businessDate}
                aria-invalid={rangeInvalid}
                onChange={(event) => setTo(event.target.value)}
              />
            </FormField>
          </div>
        </CardBody>
      </Card>

      {rangeInvalid ? (
        <ErrorState
          title="Check the date range"
          message="The start date must be on or before the end date."
        />
      ) : report.isPending ? (
        <div className="space-y-6">
          <Skeleton variant="stat" count={6} />
          <Skeleton variant="row" count={6} />
        </div>
      ) : report.isError ? (
        <ErrorState
          message={toUserMessage(report.error)}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryCard
              label="Supposed revenue"
              info="This is what you billed on the sale date."
              value={<Money kobo={supposed} tone="neutral" />}
            />
            <SummaryCard
              label="Revenue gotten"
              info="Cash actually received in the selected period. If an old debt is paid today, it shows here today."
              value={<Money kobo={gotten} tone="neutral" />}
            />
            <SummaryCard
              label="Outstanding debt"
              info="Billed revenue not collected yet within the selected period."
              value={
                debt > 0n ? (
                  <Money kobo={debt} />
                ) : (
                  <Money kobo={0n} tone="neutral" />
                )
              }
            />
            <SummaryCard
              label="Gross profit"
              value={<Money kobo={grossProfit} />}
            />
            <SummaryCard
              label="Total expenses"
              value={<Money kobo={expenses} tone="neutral" />}
            />
            <SummaryCard
              label="Net profit"
              value={<Money kobo={netProfit} className="text-xl font-bold" />}
            />
          </div>

          <Card>
            <CardBody className="space-y-3">
              <h2 className="flex items-center gap-2 text-section font-semibold">
                Why doesn&apos;t it tally?
                <InfoHint label="Explain why the report may not tally">
                  <span className="block">
                    `Supposed revenue` is what you billed. `Revenue gotten` is
                    the cash collected in this date range.
                  </span>
                  <span className="mt-2 block">
                    The numbers differ when customers still owe, when old debts
                    are paid later, or when you sell below your normal price.
                  </span>
                  <span className="mt-2 block">
                    `Discounts given` means the billed price is below your
                    normal selling worth.
                  </span>
                </InfoHint>
              </h2>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    Outstanding debts (supposed minus gotten)
                  </span>
                  <span className="font-medium">
                    {debt > 0n ? (
                      <Money kobo={debt} />
                    ) : (
                      <Money kobo={0n} tone="neutral" />
                    )}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    Discounts given (standard price minus supposed)
                  </span>
                  <span className="font-medium">
                    {discount > 0n ? (
                      <Money kobo={discount} />
                    ) : (
                      <Money kobo={0n} tone="neutral" />
                    )}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Expenses</span>
                  <span className="font-medium">
                    <Money kobo={expenses} tone="neutral" />
                  </span>
                </li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Daily breakdown"
              description="Newest first."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportCsv}
                  disabled={days.length === 0}
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Export CSV
                </Button>
              }
            />
            <CardBody>
              {days.length === 0 ? (
                <EmptyState
                  title="No sales in this period"
                  description="Try a wider date range or check a different business day."
                />
              ) : (
                <div className="space-y-3">
                  <ResponsiveTable
                    rows={days}
                    columns={columns}
                    getKey={(day) => day.date}
                  />
                  {totals && (
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <span className="text-sm font-semibold">
                          Totals ({days.length}{" "}
                          {days.length === 1 ? "day" : "days"})
                        </span>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                          <span className="text-muted-foreground">
                            Supposed{" "}
                            <span className="font-semibold text-foreground">
                              <Money kobo={supposed} tone="neutral" />
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            Gotten{" "}
                            <span className="font-semibold text-foreground">
                              <Money kobo={gotten} tone="neutral" />
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            Net{" "}
                            <span className="font-bold text-foreground">
                              <Money kobo={netProfit} />
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  info,
}: {
  label: string;
  value: React.ReactNode;
  info?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {info && (
          <InfoHint label={`Explain ${label}`}>
            {info}
          </InfoHint>
        )}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}