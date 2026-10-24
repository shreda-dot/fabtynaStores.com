"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getLagosBusinessDate } from "@fabtyna/shared";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { salesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type { SaleListItemDto } from "@/lib/api/sales.api";
import {
  inclusiveDays,
  presetRange,
  sumCustomerSales,
  validatePeriod,
  type PeriodPreset,
} from "@/lib/customer-sales-totals";
import { queryKeys } from "@/lib/query-keys";

const PAGE_LIMIT = 200;
const MAX_PAGES = 25; // 5,000 sales; beyond that we refuse to show a partial total

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
];

async function loadCompletedSales(
  customerId: string,
  from: string,
  to: string,
): Promise<{ items: SaleListItemDto[]; truncated: boolean }> {
  const items: SaleListItemDto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await salesApi.listPage({
      customerId,
      from,
      to,
      status: "COMPLETED",
      limit: PAGE_LIMIT,
      cursor,
    });
    items.push(...result.items);
    if (result.nextCursor === null) return { items, truncated: false };
    cursor = result.nextCursor;
  }
  return { items, truncated: true };
}

export function CustomerSalesTotals({ customerId }: { customerId: string }) {
  const today = useLagosBusinessDate() || getLagosBusinessDate();
  const [from, setFrom] = useState(() => getLagosBusinessDate());
  const [to, setTo] = useState(() => getLagosBusinessDate());

  const problem = validatePeriod(from, to, today);

  const sales = useQuery({
    queryKey: [...queryKeys.sales.all, "customer-totals", customerId, from, to],
    queryFn: () => loadCompletedSales(customerId, from, to),
    enabled: problem === null,
  });

  const totals = useMemo(
    () => (sales.data && !sales.data.truncated ? sumCustomerSales(sales.data.items) : null),
    [sales.data],
  );

  function applyPreset(preset: PeriodPreset) {
    const range = presetRange(preset, today);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <Card>
      <CardHeader
        title="Sales in a period"
        description="Completed sales only. Voided sales and the customer's older debts are not included."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset(preset.key)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="period-from" label="From">
            <Input
              id="period-from"
              type="date"
              value={from}
              max={today}
              onChange={(event) => setFrom(event.target.value)}
            />
          </FormField>
          <FormField id="period-to" label="To">
            <Input
              id="period-to"
              type="date"
              value={to}
              max={today}
              onChange={(event) => setTo(event.target.value)}
            />
          </FormField>
        </div>

        {problem !== null ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {problem}
          </p>
        ) : sales.isPending ? (
          <Skeleton variant="stat" count={4} />
        ) : sales.isError ? (
          <ErrorState
            title="Sales could not be loaded"
            message={toUserMessage(sales.error)}
            onRetry={() => void sales.refetch()}
          />
        ) : sales.data.truncated ? (
          <p role="alert" className="text-sm font-medium text-danger">
            This customer has too many sales in this period to total here. Choose a shorter period.
          </p>
        ) : totals !== null ? (
          <>
            <p className="text-sm text-muted-foreground">
              {from === to ? from : `${from} to ${to}`} ({inclusiveDays(from, to)}{" "}
              {inclusiveDays(from, to) === 1 ? "day" : "days"})
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Sales made" value={totals.count} />
              <StatCard
                label="Total billed"
                value={<Money kobo={totals.billedKobo} tone="neutral" />}
              />
              <StatCard
                label="Paid so far"
                value={<Money kobo={totals.paidKobo} tone="neutral" />}
              />
              <StatCard
                label="Still owed on these sales"
                value={<Money kobo={totals.owedKobo} tone="auto" />}
                tone={totals.owedKobo > 0n ? "danger" : "default"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              &quot;Paid so far&quot; counts every payment made on these sales, including payments
              made after the period.
            </p>
            {from === to && totals.count > 0 && (
              <Link
                href={`/sales?customerId=${encodeURIComponent(customerId)}&date=${from}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Open these sales in the Sales list
              </Link>
            )}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}