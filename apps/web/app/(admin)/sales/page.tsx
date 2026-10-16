"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  formatLagosDate,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
  type SaleChannel,
  type SaleStatus,
} from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { RecordDebtorDialog } from "@/components/debtors/Record-debtor-dialog";
import { ResponsiveTable } from "@/components/responsive-table";
import type { ResponsiveTableColumn } from "@/components/responsive-table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, type StatTrend } from "@/components/ui/stat-card";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { salesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { SaleListItemDto } from "@/lib/api/sales.api";

const CHANNELS: (SaleChannel | "ALL")[] = ["ALL", "RETAIL", "WHOLESALE"];
const STATUSES: (SaleStatus | "ALL")[] = [
  "ALL",
  "DRAFT",
  "COMPLETED",
  "VOIDED",
];

const PAGE_SIZE = 50;
const TOP_DEBTORS = 3;
// URL value meaning "every date". When the `date` param is absent the list
// defaults to today's Lagos business day.
const ALL_DATES = "all";

function parseChannel(value: string | null): SaleChannel | "ALL" {
  return value === "RETAIL" || value === "WHOLESALE" ? value : "ALL";
}

function parseStatus(value: string | null): SaleStatus | "ALL" {
  return value === "DRAFT" || value === "COMPLETED" || value === "VOIDED"
    ? value
    : "ALL";
}

function trendFor(today: bigint, yesterday: bigint): StatTrend | undefined {
  if (today === 0n && yesterday === 0n) return undefined;
  const direction =
    today > yesterday ? "up" : today < yesterday ? "down" : "flat";
  return {
    direction,
    label:
      direction === "flat"
        ? "Same as yesterday"
        : `${direction === "up" ? "Up" : "Down"} vs yesterday`,
  };
}

export default function SalesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <SalesContent />
    </Suspense>
  );
}

function SalesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Business day follows Africa/Lagos time and rolls over automatically.
  const businessDate = useLagosBusinessDate();

  const filterChannel = parseChannel(searchParams.get("channel"));
  const filterStatus = parseStatus(searchParams.get("status"));
  const filterSearch = searchParams.get("q") ?? "";

  // Date filter: absent param = today, "all" = every date, else a specific day.
  const dateParam = searchParams.get("date");
  const showAllDates = dateParam === ALL_DATES;
  const filterDate = showAllDates ? "" : (dateParam ?? businessDate);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === "" || value === "ALL") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs === "" ? pathname : `${pathname}?${qs}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const sales = useQuery({
    queryKey: queryKeys.sales.list,
    queryFn: () => salesApi.list(),
  });

  const [debtorDialogOpen, setDebtorDialogOpen] = useState(false);

  const { start: todayStart, end: todayEnd } =
    getLagosBusinessDayRange(businessDate);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  const yesterdayStartMs = yesterdayStart.getTime();

  const stats = useMemo(() => {
    const rows = sales.data ?? [];
    let todayRetail = 0n;
    let todayWholesale = 0n;
    let yesterdayRetail = 0n;
    let yesterdayWholesale = 0n;

    for (const sale of rows) {
      if (sale.status === "VOIDED") continue;
      const soldAt = new Date(sale.soldAt).getTime();
      const total = BigInt(sale.totalKobo);
      if (soldAt >= todayStartMs && soldAt < todayEndMs) {
        if (sale.channel === "RETAIL") todayRetail += total;
        else todayWholesale += total;
      } else if (soldAt >= yesterdayStartMs && soldAt < todayStartMs) {
        if (sale.channel === "RETAIL") yesterdayRetail += total;
        else yesterdayWholesale += total;
      }
    }

    return { todayRetail, todayWholesale, yesterdayRetail, yesterdayWholesale };
  }, [sales.data, todayStartMs, todayEndMs, yesterdayStartMs]);

  const filtered = useMemo(() => {
    const query = filterSearch.trim().toLowerCase();
    return (sales.data ?? [])
      .filter((sale) => {
        if (filterChannel !== "ALL" && sale.channel !== filterChannel)
          return false;
        if (filterStatus !== "ALL" && sale.status !== filterStatus)
          return false;
        if (
          filterDate !== "" &&
          getLagosBusinessDate(new Date(sale.soldAt)) !== filterDate
        )
          return false;
        if (query !== "") {
          const haystack =
            `${sale.customerName ?? ""} ${sale.reference ?? ""}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort(
        (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime(),
      );
  }, [sales.data, filterChannel, filterStatus, filterDate, filterSearch]);

  // Show the list in pages so "all dates" never renders thousands of rows.
  // The limit resets automatically whenever any filter changes.
  const filterKey = `${filterChannel}|${filterStatus}|${filterDate}|${filterSearch}`;
  const [limitState, setLimitState] = useState({
    key: filterKey,
    count: PAGE_SIZE,
  });
  const visibleCount =
    limitState.key === filterKey ? limitState.count : PAGE_SIZE;
  const visible = filtered.slice(0, visibleCount);

  const debtors = useMemo(() => {
    return (sales.data ?? [])
      .filter(
        (sale) =>
          sale.status !== "VOIDED" &&
          BigInt(sale.totalKobo) - BigInt(sale.paidKobo) > 0n,
      )
      .sort((a, b) => {
        const owedA = BigInt(a.totalKobo) - BigInt(a.paidKobo);
        const owedB = BigInt(b.totalKobo) - BigInt(b.paidKobo);
        if (owedA === owedB) return 0;
        return owedA > owedB ? -1 : 1;
      });
  }, [sales.data]);

  const totalDebt = debtors.reduce(
    (sum, s) => sum + (BigInt(s.totalKobo) - BigInt(s.paidKobo)),
    0n,
  );

  const otherFiltersActive =
    filterSearch !== "" || filterChannel !== "ALL" || filterStatus !== "ALL";

  const columns: ResponsiveTableColumn<SaleListItemDto>[] = [
    {
      header: "Date",
      render: (sale) => formatLagosDate(sale.soldAt),
    },
    {
      header: "Reference",
      render: (sale) => (
        <Link
          href={`/sales/${sale.id}`}
          className="font-medium text-primary hover:underline"
        >
          {sale.reference ?? sale.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Channel",
      render: (sale) => (
        <Badge tone={sale.channel === "RETAIL" ? "info" : "accent"}>
          {sale.channel === "RETAIL" ? "Retail" : "Wholesale"}
        </Badge>
      ),
    },
    {
      header: "Customer",
      render: (sale) => sale.customerName ?? "Walk-in",
    },
    {
      header: "Lines",
      align: "right",
      render: (sale) => <span className="tabular">{sale.lineCount}</span>,
    },
    {
      header: "Total",
      align: "right",
      render: (sale) => <Money kobo={sale.totalKobo} tone="neutral" />,
    },
    {
      header: "Paid",
      align: "right",
      render: (sale) => <Money kobo={sale.paidKobo} tone="neutral" />,
    },
    {
      header: "Status",
      render: (sale) => <StatusBadge status={sale.status} />,
    },
  ];

  const listScope = showAllDates
    ? "all dates"
    : filterDate === businessDate
      ? "today"
      : filterDate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Retail (fridge) and wholesale sales."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setDebtorDialogOpen(true)}
            >
              <HandCoins aria-hidden="true" className="h-4 w-4" />
              Record debtor
            </Button>
            <Link href="/sales/new" className={buttonClasses({ size: "md" })}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              New sale
            </Link>
          </>
        }
      />

      {sales.isPending ? (
        <Skeleton variant="stat" count={3} />
      ) : sales.isError ? null : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Today — retail"
            value={<Money kobo={stats.todayRetail} tone="neutral" />}
            trend={trendFor(stats.todayRetail, stats.yesterdayRetail)}
          />
          <StatCard
            label="Today — wholesale"
            value={<Money kobo={stats.todayWholesale} tone="neutral" />}
            trend={trendFor(stats.todayWholesale, stats.yesterdayWholesale)}
          />
          <StatCard
            label="Total still owed"
            value={<Money kobo={totalDebt} tone="neutral" />}
            tone={totalDebt > 0n ? "danger" : "default"}
            hint="All unpaid balances from every date."
          />
        </div>
      )}

      {!sales.isPending && !sales.isError && debtors.length > 0 && (
        <section className="rounded-md border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-section font-semibold">Biggest debts</h2>
            </div>
            <Link
              href="/debtors"
              className="text-sm text-primary hover:underline"
            >
              View all debtors
            </Link>
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {debtors.slice(0, TOP_DEBTORS).map((s) => {
              const owed = BigInt(s.totalKobo) - BigInt(s.paidKobo);
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.customerName ?? "Walk-in"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.channel === "RETAIL" ? "Retail" : "Wholesale"} ·{" "}
                      {formatLagosDate(s.soldAt)}
                    </p>
                  </div>
                  <Money kobo={owed} className="shrink-0" />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="sales-search" label="Search">
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <Search
                aria-hidden="true"
                className="h-4 w-4 text-muted-foreground"
              />
              <SearchField
                value={filterSearch}
                onChange={(value) => setParams({ q: value })}
              />
            </div>
          </FormField>
          <FormField id="sales-channel" label="Channel">
            <Select
              id="sales-channel"
              value={filterChannel}
              onChange={(event) => setParams({ channel: event.target.value })}
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch === "ALL"
                    ? "All channels"
                    : ch === "RETAIL"
                      ? "Retail (fridge)"
                      : "Wholesale"}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="sales-status" label="Status">
            <Select
              id="sales-status"
              value={filterStatus}
              onChange={(event) => setParams({ status: event.target.value })}
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st === "ALL" ? "All statuses" : st}
                </option>
              ))}
            </Select>
          </FormField>
          <DateFilter
            id="sales-date"
            value={filterDate}
            onChange={(value) =>
              setParams({
                // Cleared input = every date. Picking today goes back to the
                // default (no param) so it keeps following the Lagos day.
                date:
                  value === ""
                    ? ALL_DATES
                    : value === businessDate
                      ? ""
                      : value,
              })
            }
            max={businessDate}
          />
        </div>

        {sales.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : sales.isError ? (
          <ErrorState
            title="Sales could not be loaded"
            message={toUserMessage(sales.error)}
            onRetry={() => void sales.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              otherFiltersActive
                ? "No sales match these filters"
                : `No sales for ${listScope}`
            }
            description={
              otherFiltersActive
                ? "Try clearing the search, channel or status filter."
                : "Record a sale, or look at another date."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {otherFiltersActive && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setParams({ q: "", channel: "ALL", status: "ALL" })
                    }
                  >
                    Clear filters
                  </Button>
                )}
                {!showAllDates && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setParams({ date: ALL_DATES })}
                  >
                    Show all dates
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {visible.length} of {filtered.length} sales for{" "}
              {listScope}.
            </p>
            <ResponsiveTable
              rows={visible}
              columns={columns}
              getKey={(sale) => sale.id}
            />
            {visible.length < filtered.length && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setLimitState({
                      key: filterKey,
                      count: visibleCount + PAGE_SIZE,
                    })
                  }
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - visible.length)}{" "}
                  more
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <RecordDebtorDialog
        open={debtorDialogOpen}
        onClose={() => setDebtorDialogOpen(false)}
      />
    </div>
  );
}

/**
 * Keeps typing responsive by holding the text locally and only pushing the
 * debounced value into the URL. External URL changes (refresh/back) sync back.
 */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  // Push external URL changes (refresh/back) into the uncontrolled input.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || input.value === value) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    input.value = value;
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onChange(next);
    }, 300);
  }

  return (
    <input
      ref={inputRef}
      id="sales-search"
      type="search"
      defaultValue={value}
      onChange={handleChange}
      placeholder="Customer name or reference"
      className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
    />
  );
}
