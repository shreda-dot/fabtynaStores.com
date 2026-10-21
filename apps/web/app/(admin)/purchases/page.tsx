"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
} from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatLagosDate, isPurchaseOverdue } from "@fabtyna/shared";
import { DateFilter } from "@/components/date-filter";
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
import { purchasesApi, suppliersApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import {
  purchaseBalanceDueKobo,
  type PurchaseListItemDto,
  type PurchaseListOptions,
} from "@/lib/api/purchases.api";
import { queryKeys } from "@/lib/query-keys";

type StatusFilter = "RECEIVED" | "VOIDED" | "ALL";
const STATUSES: StatusFilter[] = ["ALL", "RECEIVED", "VOIDED"];

const PAGE_SIZE = 50;
// URL value meaning "every date": the last 365 days (the API caps a range at 366).
const ALL_DATES = "all";

function parseStatus(value: string | null): StatusFilter {
  return value === "RECEIVED" || value === "VOIDED" ? value : "ALL";
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function PurchasesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <PurchasesContent />
    </Suspense>
  );
}

function PurchasesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const businessDate = useLagosBusinessDate();

  const filterStatus = parseStatus(searchParams.get("status"));
  const filterSearch = searchParams.get("q") ?? "";
  const filterUnpaid = searchParams.get("unpaid") === "1";
  const filterOverdue = searchParams.get("overdue") === "1";
  const filterSupplierId = searchParams.get("supplierId") ?? "";

  const dateParam = searchParams.get("date");
  const showAllDates = dateParam === ALL_DATES;
  const filterDate = showAllDates ? "" : (dateParam ?? businessDate);

  // Like the API: a search, debt, overdue or supplier filter looks at every
  // period unless the user picked a date.
  const wideSearch =
    filterSearch.trim() !== "" ||
    filterUnpaid ||
    filterOverdue ||
    filterSupplierId !== "";

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

  const filters = useMemo<PurchaseListOptions>(() => {
    const options: PurchaseListOptions = { limit: PAGE_SIZE };
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
    if (filterStatus !== "ALL") options.status = filterStatus;
    if (filterSearch.trim() !== "") options.search = filterSearch.trim();
    if (filterUnpaid) options.unpaid = true;
    if (filterOverdue) options.overdue = true;
    if (filterSupplierId !== "") options.supplierId = filterSupplierId;
    return options;
  }, [
    showAllDates,
    dateParam,
    wideSearch,
    businessDate,
    filterStatus,
    filterSearch,
    filterUnpaid,
    filterOverdue,
    filterSupplierId,
  ]);

  const purchases = useInfiniteQuery({
    queryKey: queryKeys.purchases.page(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      purchasesApi.listPage({ ...filters, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor,
  });

  // Read before the render branches narrow `purchases`.
  const loadMoreFailed = purchases.isFetchNextPageError;
  const queryError: unknown = purchases.error;
  const fetchNext = purchases.fetchNextPage;

  const suppliers = useQuery({
    queryKey: queryKeys.suppliers.list("", false, "picker"),
    queryFn: () => suppliersApi.list({ limit: 100 }),
  });

  const rows = useMemo(
    () => (purchases.data?.pages ?? []).flatMap((page) => page.items),
    [purchases.data],
  );
  const appliedFrom = purchases.data?.pages[0]?.from ?? null;
  const appliedTo = purchases.data?.pages[0]?.to ?? null;

  const otherFiltersActive =
    filterSearch !== "" ||
    filterStatus !== "ALL" ||
    filterUnpaid ||
    filterOverdue ||
    filterSupplierId !== "";

  const columns: ResponsiveTableColumn<PurchaseListItemDto>[] = [
    {
      header: "Reference",
      render: (purchase) => (
        <Link
          href={`/purchases/${purchase.id}`}
          className="font-medium text-primary hover:underline"
        >
          {purchase.reference ?? purchase.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Supplier",
      render: (purchase) => purchase.supplierName ?? "No supplier",
    },
    {
      header: "Date",
      render: (purchase) => formatLagosDate(purchase.purchasedAt),
    },
    {
      header: "Lines",
      align: "right",
      render: (purchase) => (
        <span className="tabular">{purchase.lineCount}</span>
      ),
    },
    {
      header: "Total",
      align: "right",
      render: (purchase) => <Money kobo={purchase.totalKobo} tone="neutral" />,
    },
    {
      header: "Paid",
      align: "right",
      render: (purchase) => <Money kobo={purchase.paidKobo} tone="neutral" />,
    },
    {
      header: "Balance",
      align: "right",
      render: (purchase) => {
        const balance = purchaseBalanceDueKobo(purchase);
        return balance > 0n ? (
          <Money kobo={balance} />
        ) : (
          <span className="text-muted-foreground">
            <Money kobo={0n} tone="neutral" />
          </span>
        );
      },
    },
    {
      header: "Payment",
      render: (purchase) => {
        if (purchase.status === "VOIDED") {
          return <Badge tone="neutral">—</Badge>;
        }
        const balance = purchaseBalanceDueKobo(purchase);
        if (
          balance > 0n &&
          isPurchaseOverdue(
            {
              totalKobo: BigInt(purchase.totalKobo),
              paidKobo: BigInt(purchase.totalKobo) - balance,
              dueDate: purchase.dueDate,
              status: purchase.status,
            },
            businessDate,
          )
        ) {
          return <Badge tone="danger">Overdue</Badge>;
        }
        const label =
          balance === 0n
            ? "Paid"
            : balance === BigInt(purchase.totalKobo)
              ? "Unpaid"
              : "Partial";
        return <StatusBadge status={label} />;
      },
    },
    {
      header: "Status",
      render: (purchase) => <StatusBadge status={purchase.status} />,
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
        title="Purchases"
        description="Record goods received into your store."
        actions={
          <Link href="/purchases/new" className={buttonClasses({})}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New purchase
          </Link>
        }
      />

      <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <FormField id="purchases-search" label="Search">
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
          <FormField id="purchases-status" label="Status">
            <Select
              id="purchases-status"
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
          <FormField id="purchases-supplier" label="Supplier">
            <Select
              id="purchases-supplier"
              value={filterSupplierId}
              onChange={(event) =>
                setParams({ supplierId: event.target.value })
              }
            >
              <option value="">All suppliers</option>
              {(suppliers.data ?? []).map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </FormField>
          <DateFilter
            id="purchases-date"
            value={filterDate}
            onChange={(value) =>
              setParams({
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
          <div className="flex flex-col justify-end">
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
          <div className="flex flex-col justify-end">
            <label className="flex min-h-12 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={filterOverdue}
                onChange={(event) =>
                  setParams({ overdue: event.target.checked ? "1" : "" })
                }
              />
              Overdue only (any date)
            </label>
          </div>
        </div>

        {purchases.isPending ? (
          <Skeleton variant="row" count={6} />
        ) : purchases.isError ? (
          <ErrorState
            title="Purchases could not be loaded"
            message={toUserMessage(purchases.error)}
            onRetry={() => void purchases.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              otherFiltersActive
                ? "No purchases match these filters"
                : `No purchases for ${listScope}`
            }
            description={
              otherFiltersActive
                ? "Try clearing the search, supplier or status filter."
                : "Record goods received, or look at another date."
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
                        status: "ALL",
                        unpaid: "",
                        overdue: "",
                        supplierId: "",
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
              Showing {rows.length} purchases for {listScope}
              {purchases.hasNextPage ? " (more available)" : ""}.
            </p>
            <ResponsiveTable
              rows={rows}
              columns={columns}
              getKey={(purchase) => purchase.id}
            />
            {loadMoreFailed && (
              <ErrorState
                title="More purchases could not be loaded"
                message={toUserMessage(queryError)}
                onRetry={() => void fetchNext()}
              />
            )}
            {purchases.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  loading={purchases.isFetchingNextPage}
                  onClick={() => void fetchNext()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Debounced search box that syncs with the URL, as on the sales list. */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

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
      id="purchases-search"
      type="search"
      defaultValue={value}
      onChange={handleChange}
      placeholder="Supplier name or reference"
      className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
    />
  );
}
