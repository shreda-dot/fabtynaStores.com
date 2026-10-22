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
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { HandCoins, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatLagosDate } from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
import { RecordDebtorDialog } from "../../../components/debtors/record-debtor-dialog";
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
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { customersApi, salesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import {
  saleBalanceDueKobo,
  type SaleListItemDto,
  type SaleListOptions,
} from "@/lib/api/sales.api";

type ChannelFilter = "RETAIL" | "WHOLESALE" | "ALL";
type StatusFilter = "COMPLETED" | "VOIDED" | "ALL";

const CHANNELS: ChannelFilter[] = ["ALL", "RETAIL", "WHOLESALE"];
const STATUSES: StatusFilter[] = ["ALL", "COMPLETED", "VOIDED"];

const PAGE_SIZE = 50;
// URL value meaning "every date". The API caps a range at 366 days, so this is
// the last 365 days.
const ALL_DATES = "all";

function parseChannel(value: string | null): ChannelFilter {
  return value === "RETAIL" || value === "WHOLESALE" ? value : "ALL";
}

function parseStatus(value: string | null): StatusFilter {
  return value === "COMPLETED" || value === "VOIDED" ? value : "ALL";
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
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

  const businessDate = useLagosBusinessDate();

  const filterChannel = parseChannel(searchParams.get("channel"));
  const filterStatus = parseStatus(searchParams.get("status"));
  const filterSearch = searchParams.get("q") ?? "";
  const filterUnpaid = searchParams.get("unpaid") === "1";
  const filterCustomerId = searchParams.get("customerId") ?? "";

  // Date filter: absent param = today, "all" = last 365 days, else one day.
  const dateParam = searchParams.get("date");
  const showAllDates = dateParam === ALL_DATES;
  const filterDate = showAllDates ? "" : (dateParam ?? businessDate);

  // Like the API: a search, the unpaid filter or a customer filter looks at
  // every period unless the user picked a date themselves.
  const wideSearch = filterSearch.trim() !== "" || filterUnpaid || filterCustomerId !== "";

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

  const filters = useMemo<SaleListOptions>(() => {
    const options: SaleListOptions = { limit: PAGE_SIZE };
    if (showAllDates) {
      options.from = daysBefore(businessDate, 365);
      options.to = businessDate;
    } else if (dateParam !== null) {
      options.from = dateParam;
      options.to = dateParam;
    } else if (!wideSearch) {
      options.from = businessDate;
      options.to = businessDate;
    }
    if (filterChannel !== "ALL") options.channel = filterChannel;
    if (filterStatus !== "ALL") options.status = filterStatus;
    if (filterSearch.trim() !== "") options.search = filterSearch.trim();
    if (filterUnpaid) options.unpaid = true;
    if (filterCustomerId !== "") options.customerId = filterCustomerId;
    return options;
  }, [
    showAllDates,
    dateParam,
    wideSearch,
    businessDate,
    filterChannel,
    filterStatus,
    filterSearch,
    filterUnpaid,
    filterCustomerId,
  ]);

  const sales = useInfiniteQuery({
    queryKey: queryKeys.sales.page(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => salesApi.listPage({ ...filters, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor,
  });

  // Read before the render branches narrow `sales`.
  const loadMoreFailed = sales.isFetchNextPageError;
  const queryError: unknown = sales.error;
  const fetchNext = sales.fetchNextPage;

  const customers = useQuery({
    queryKey: queryKeys.customers.list("", false, "picker"),
    queryFn: () => customersApi.list({ limit: 100 }),
  });

  const [debtorDialogOpen, setDebtorDialogOpen] = useState(false);

  const rows = useMemo(
    () => (sales.data?.pages ?? []).flatMap((page) => page.items),
    [sales.data],
  );
  const appliedFrom = sales.data?.pages[0]?.from ?? null;
  const appliedTo = sales.data?.pages[0]?.to ?? null;

  const otherFiltersActive =
    filterSearch !== "" ||
    filterChannel !== "ALL" ||
    filterStatus !== "ALL" ||
    filterUnpaid ||
    filterCustomerId !== "";

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
      header: "Owed",
      align: "right",
      render: (sale) => (
        <Money kobo={saleBalanceDueKobo(sale)} tone="neutral" />
      ),
    },
    {
      header: "Status",
      render: (sale) => <StatusBadge status={sale.status} />,
    },
  ];

  const listScope = showAllDates
    ? "the last 365 days"
    : appliedFrom === null
      ? "all dates"
      : appliedFrom === appliedTo
        ? appliedFrom === businessDate
          ? "today"
          : appliedFrom
        : `${appliedFrom} to ${appliedTo}`;

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

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          <FormField id="sales-customer" label="Customer">
            <Select
              id="sales-customer"
              value={filterCustomerId}
              onChange={(event) => setParams({ customerId: event.target.value })}
            >
              <option value="">All customers</option>
              {(customers.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </FormField>
          <DateFilter
            id="sales-date"
            value={filterDate}
            onChange={(value) =>
              setParams({
                // Cleared input = last 365 days. Picking today goes back to
                // the default (no param) so it keeps following the Lagos day.
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
          <div className="flex items-end">
            <label className="flex min-h-12 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={filterUnpaid}
                onChange={(event) =>
                  setParams({ unpaid: event.target.checked ? "1" : "" })
                }
              />
              Unpaid only (any date)
            </label>
          </div>
        </div>

        {sales.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : sales.isError ? (
          <ErrorState
            title="Sales could not be loaded"
            message={toUserMessage(sales.error)}
            onRetry={() => void sales.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              otherFiltersActive
                ? "No sales match these filters"
                : `No sales for ${listScope}`
            }
            description={
              otherFiltersActive
                ? "Try clearing the search, channel, customer or status filter."
                : "Record a sale, or look at another date."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {otherFiltersActive && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setParams({
                        q: "",
                        channel: "ALL",
                        status: "ALL",
                        unpaid: "",
                        customerId: "",
                      })
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
                    Show the last 365 days
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {rows.length} sales for {listScope}
              {sales.hasNextPage ? " (more available)" : ""}.
            </p>
            <ResponsiveTable
              rows={rows}
              columns={columns}
              getKey={(sale) => sale.id}
            />
            {loadMoreFailed && (
              <ErrorState
                title="More sales could not be loaded"
                message={toUserMessage(queryError)}
                onRetry={() => void fetchNext()}
              />
            )}
            {sales.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  loading={sales.isFetchingNextPage}
                  onClick={() => void sales.fetchNextPage()}
                >
                  Load more
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
