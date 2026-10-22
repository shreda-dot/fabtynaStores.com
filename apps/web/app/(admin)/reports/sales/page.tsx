"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { formatLagosDate } from "@fabtyna/shared";
import { InfoHint } from "@/components/info-hint";
import {
  EffectiveRange,
  ReportRangeFields,
} from "@/components/reports/report-range";
import { ReportTabs } from "@/components/reports/report-tabs";
import { ReportToolbar } from "@/components/reports/report-toolbar";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { isMockApiMode, reportsApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type {
  ReportChannel,
  SalesSummaryDayDto,
  SalesSummaryTotalsDto,
} from "@/lib/api/reports.api";
import { queryKeys } from "@/lib/query-keys";
import {
  REPORT_STALE_MS,
  validateReportRange,
} from "@/lib/report-range";

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

type ChannelTotalsRow = {
  label: string;
  supposed: string;
  gotten: string;
  cogs: string;
  gross: string;
  expenses: string;
  net: string;
};

function channelRows(totals: SalesSummaryTotalsDto): ChannelTotalsRow[] {
  return [
    {
      label: "Retail",
      supposed: totals.retailSupposedRevenueKobo,
      gotten: totals.retailRevenueGottenKobo,
      cogs: totals.retailCogsKobo,
      gross: totals.retailGrossProfitKobo,
      expenses: totals.retailExpensesKobo,
      net: totals.retailNetProfitKobo,
    },
    {
      label: "Wholesale",
      supposed: totals.wholesaleSupposedRevenueKobo,
      gotten: totals.wholesaleRevenueGottenKobo,
      cogs: totals.wholesaleCogsKobo,
      gross: totals.wholesaleGrossProfitKobo,
      expenses: totals.wholesaleExpensesKobo,
      net: totals.wholesaleNetProfitKobo,
    },
    {
      label: "Total",
      supposed: totals.totalSupposedRevenueKobo,
      gotten: totals.totalRevenueGottenKobo,
      cogs: totals.totalCogsKobo,
      gross: totals.totalGrossProfitKobo,
      expenses: totals.totalExpensesKobo,
      net: totals.totalNetProfitKobo,
    },
  ];
}

const channelColumns: ResponsiveTableColumn<ChannelTotalsRow>[] = [
  {
    header: "Channel",
    render: (row) => (
      <span className={row.label === "Total" ? "font-semibold" : undefined}>
        {row.label}
      </span>
    ),
  },
  {
    header: "Supposed revenue",
    align: "right",
    render: (row) => <Money kobo={row.supposed} tone="neutral" />,
  },
  {
    header: "Gotten revenue",
    align: "right",
    render: (row) => <Money kobo={row.gotten} tone="neutral" />,
  },
  {
    header: "COGS",
    align: "right",
    render: (row) => <Money kobo={row.cogs} tone="neutral" />,
  },
  {
    header: "Gross profit",
    align: "right",
    render: (row) => <Money kobo={row.gross} />,
  },
  {
    header: "Expenses",
    align: "right",
    render: (row) => <Money kobo={row.expenses} tone="neutral" />,
  },
  {
    header: "Net profit",
    align: "right",
    render: (row) => <Money kobo={row.net} className="font-semibold" />,
  },
];

const dayColumns: ResponsiveTableColumn<SalesSummaryDayDto>[] = [
  { header: "Date", render: (day) => formatLagosDate(day.date) },
  {
    header: "Supposed",
    align: "right",
    render: (day) => <Money kobo={day.totalSupposedRevenueKobo} tone="neutral" />,
  },
  {
    header: "Gotten",
    align: "right",
    render: (day) => <Money kobo={day.totalRevenueGottenKobo} tone="neutral" />,
  },
  {
    header: "COGS",
    align: "right",
    render: (day) => <Money kobo={day.totalCogsKobo} tone="neutral" />,
  },
  {
    header: "Gross profit",
    align: "right",
    render: (day) => <Money kobo={day.totalGrossProfitKobo} />,
  },
  {
    header: "Expenses",
    align: "right",
    render: (day) => <Money kobo={day.totalExpensesKobo} tone="neutral" />,
  },
  {
    header: "Net profit",
    align: "right",
    render: (day) => (
      <Money kobo={day.totalNetProfitKobo} className="font-semibold" />
    ),
  },
];

export default function SalesReportPage() {
  const businessDate = useLagosBusinessDate();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [channelChoice, setChannelChoice] = useState<ReportChannel | "">("");

  const from = range?.from ?? businessDate;
  const to = range?.to ?? businessDate;
  const channel: ReportChannel | null =
    isMockApiMode || channelChoice === "" ? null : channelChoice;
  const rangeError = validateReportRange(from, to);

  const report = useQuery({
    queryKey: queryKeys.reports.salesSummary(from, to, channel),
    queryFn: () =>
      reportsApi.salesSummary({
        from,
        to,
        channel: channel ?? undefined,
      }),
    enabled: rangeError === null,
    staleTime: REPORT_STALE_MS,
  });

  const days = useMemo(
    () =>
      [...(report.data?.days ?? [])].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
    [report.data?.days],
  );

  const totals = report.data?.totals;

  function exportCsv() {
    const header = [
      "Date",
      "Supposed revenue",
      "Gotten revenue",
      "COGS",
      "Gross profit",
      "Expenses",
      "Net profit",
    ];
    const rows = days.map((day) => [
      day.date,
      koboToDecimal(day.totalSupposedRevenueKobo),
      koboToDecimal(day.totalRevenueGottenKobo),
      koboToDecimal(day.totalCogsKobo),
      koboToDecimal(day.totalGrossProfitKobo),
      koboToDecimal(day.totalExpensesKobo),
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
        title="Sales summary"
        description="Revenue, cost of goods sold and profit by day and channel."
      />
      <ReportTabs />

      <Card>
        <CardBody className="space-y-4">
          <ReportRangeFields
            idPrefix="sales-summary"
            from={from}
            to={to}
            businessDate={businessDate}
            error={rangeError}
            onChange={(nextFrom, nextTo) =>
              setRange({ from: nextFrom, to: nextTo })
            }
          />
          {isMockApiMode ? (
            <p className="text-xs text-muted-foreground">
              Demo data: the channel filter is only available when connected to
              the real server.
            </p>
          ) : (
            <div className="max-w-xs">
              <FormField id="sales-summary-channel" label="Channel">
                <Select
                  id="sales-summary-channel"
                  value={channelChoice}
                  onChange={(event) =>
                    setChannelChoice(event.target.value as ReportChannel | "")
                  }
                >
                  <option value="">All channels</option>
                  <option value="RETAIL">Retail</option>
                  <option value="WHOLESALE">Wholesale</option>
                </Select>
              </FormField>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex items-start gap-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Supposed</strong> = billed on
            non-voided sales. <strong className="text-foreground">Gotten</strong>{" "}
            = cash received. Profit counts only cash received.
          </p>
          <InfoHint label="How profit is counted">
            Gross profit is gotten revenue minus cost of goods sold. Net profit
            also subtracts expenses (including automatic loan-interest
            expenses). A payment that was later reversed is not counted here;
            Money flow dates the reversal on its own day instead.
          </InfoHint>
        </CardBody>
      </Card>

      {rangeError !== null ? (
        <ErrorState title="Check the date range" message={rangeError} />
      ) : report.isPending ? (
        <div className="space-y-6">
          <Skeleton variant="stat" count={6} />
          <Skeleton variant="row" count={6} />
        </div>
      ) : report.isError ? (
        <ErrorState
          title="The sales summary could not be loaded"
          message={toUserMessage(report.error)}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <>
          <div className="space-y-2">
            <ReportToolbar
              dataUpdatedAt={report.dataUpdatedAt}
              isFetching={report.isFetching}
              onRefresh={() => void report.refetch()}
            />
            <EffectiveRange
              from={report.data.from}
              to={report.data.to}
              channel={report.data.channel}
            />
          </div>

          {totals && (
            <Card>
              <CardHeader
                title="Totals by channel"
                description="Everything in the selected period."
              />
              <CardBody>
                <ResponsiveTable
                  rows={channelRows(totals)}
                  columns={channelColumns}
                  getKey={(row) => row.label}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Daily breakdown"
              description="Newest first. Totals across the selected channel."
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
                <ResponsiveTable
                  rows={days}
                  columns={dayColumns}
                  getKey={(day) => day.date}
                />
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
