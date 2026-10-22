"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { isMockApiMode, reportsApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type {
  ProductSalesItemDto,
  ReportChannel,
} from "@/lib/api/reports.api";
import { queryKeys } from "@/lib/query-keys";
import { REPORT_STALE_MS, validateReportRange } from "@/lib/report-range";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(text: string): { limit: number | null; error: string | null } {
  const trimmed = text.trim();
  const message = `Enter a whole number from 1 to ${MAX_LIMIT}.`;
  if (!/^\d{1,3}$/.test(trimmed)) return { limit: null, error: message };
  const limit = Number.parseInt(trimmed, 10);
  if (limit < 1 || limit > MAX_LIMIT) return { limit: null, error: message };
  return { limit, error: null };
}

const columns: ResponsiveTableColumn<ProductSalesItemDto>[] = [
  {
    header: "Product",
    render: (item) => <span className="font-medium">{item.productName}</span>,
  },
  { header: "Units sold", align: "right", render: (item) => item.unitsSold },
  {
    header: "Billed revenue",
    align: "right",
    render: (item) => <Money kobo={item.billedRevenueKobo} tone="neutral" />,
  },
  {
    header: "Cost of goods",
    align: "right",
    render: (item) => <Money kobo={item.cogsKobo} tone="neutral" />,
  },
  {
    header: "Gross profit",
    align: "right",
    render: (item) => <Money kobo={item.grossProfitKobo} />,
  },
];

export default function ProductSalesReportPage() {
  const businessDate = useLagosBusinessDate();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [channelChoice, setChannelChoice] = useState<ReportChannel | "">("");
  const [limitText, setLimitText] = useState(String(DEFAULT_LIMIT));

  const from = range?.from ?? businessDate;
  const to = range?.to ?? businessDate;
  const channel: ReportChannel | null =
    channelChoice === "" ? null : channelChoice;
  const rangeError = validateReportRange(from, to);
  const { limit, error: limitError } = parseLimit(limitText);

  const report = useQuery({
    queryKey: queryKeys.reports.productSales(
      from,
      to,
      channel,
      limit ?? DEFAULT_LIMIT,
    ),
    queryFn: () =>
      reportsApi.productSales({
        from,
        to,
        channel: channel ?? undefined,
        limit: limit ?? DEFAULT_LIMIT,
      }),
    enabled: !isMockApiMode && rangeError === null && limitError === null,
    staleTime: REPORT_STALE_MS,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product sales"
        description="Which products earned the most, ordered by billed revenue."
      />
      <ReportTabs />

      {isMockApiMode ? (
        <EmptyState
          title="Not available with demo data"
          description="Product sales is computed by the real server. Switch the app to real mode to use this report."
        />
      ) : (
        <>
          <Card>
            <CardBody className="space-y-4">
              <ReportRangeFields
                idPrefix="product-sales"
                from={from}
                to={to}
                businessDate={businessDate}
                error={rangeError}
                onChange={(nextFrom, nextTo) =>
                  setRange({ from: nextFrom, to: nextTo })
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="product-sales-channel" label="Channel">
                  <Select
                    id="product-sales-channel"
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
                <FormField
                  id="product-sales-limit"
                  label={`How many products (max ${MAX_LIMIT})`}
                  error={limitError ?? undefined}
                >
                  <Input
                    id="product-sales-limit"
                    inputMode="numeric"
                    value={limitText}
                    aria-invalid={limitError !== null}
                    onChange={(event) => setLimitText(event.target.value)}
                  />
                </FormField>
              </div>
            </CardBody>
          </Card>

          {rangeError !== null || limitError !== null ? (
            <ErrorState
              title="Check the filters"
              message={rangeError ?? limitError ?? ""}
            />
          ) : report.isPending ? (
            <Skeleton variant="row" count={6} />
          ) : report.isError ? (
            <ErrorState
              title="Product sales could not be loaded"
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
              <Card>
                <CardHeader
                  title="Top products"
                  description={report.data.revenueDefinition}
                  action={<Badge tone="warning">Billed, not cash</Badge>}
                />
                <CardBody>
                  {report.data.items.length === 0 ? (
                    <EmptyState
                      title="No product sales in this period"
                      description="Voided sales are excluded. Try a wider date range."
                    />
                  ) : (
                    <ResponsiveTable
                      rows={report.data.items}
                      columns={columns}
                      getKey={(item) => item.productId}
                    />
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
