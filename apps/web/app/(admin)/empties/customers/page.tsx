"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatLagosDateTime } from "@fabtyna/shared";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { emptiesApi, isMockApiMode } from "@/lib/api";
import type { EmptiesCustomerBalanceDto } from "@/lib/api/empties.api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerCratesPanel } from "@/components/empties/customer-crates";

const PAGE_SIZE = 50;

export default function EmptiesCustomersPage() {
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);
  const balances = useInfiniteQuery({
    queryKey: queryKeys.empties.customerBalancePages({
      q: debouncedSearch,
      onlyOwing: true,
    }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      emptiesApi.listCustomerBalances({
        q: debouncedSearch,
        onlyOwing: true,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    enabled: !isMockApiMode,
  });
  const rows = balances.data?.pages.flatMap((page) => page.items) ?? [];
  const totals = balances.data?.pages[0]?.totalsByOwner ?? [];

  const rowGroups = new Map<string, EmptiesCustomerBalanceDto[]>();
  for (const row of rows) {
    const group = rowGroups.get(row.customerId) ?? [];
    group.push(row);
    rowGroups.set(row.customerId, group);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crates customers owe"
        description="Track crates taken, returned, kept, or adjusted. Values are display-only and never enter cash or profit."
      />
      {isMockApiMode ? (
        <EmptyState
          title="Not available with demo data"
          description="Customer crate tracking needs the real server."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map((total) => (
              <Card key={total.ownerId}>
                <CardBody className="space-y-1">
                  <p className="text-sm text-muted-foreground">{total.ownerName}</p>
                  <p className="text-2xl font-semibold tabular">{total.quantity} empties owed</p>
                  {total.valueKobo !== null && <Money kobo={total.valueKobo} tone="neutral" />}
                </CardBody>
              </Card>
            ))}
          </div>
          <Card>
            <CardBody className="space-y-4">
              <Input
                aria-label="Search customers who owe crates"
                placeholder="Search customer name or phone"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {balances.isPending ? (
                <Skeleton variant="row" count={5} />
              ) : balances.isError ? (
                <ErrorState message={toUserMessage(balances.error)} onRetry={() => void balances.refetch()} />
              ) : rows.length === 0 ? (
                <EmptyState
                  title="No customers owe crates"
                  description="When customers take crates, their balances will appear here."
                />
              ) : (
                <div className="space-y-4">
                  {[...rowGroups.entries()].map(([id, customerRows]) => {
                    const first = customerRows[0]!;
                    return (
                      <section key={id} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="font-semibold">{first.customerName}</h2>
                            <p className="text-sm text-muted-foreground">
                              Last crate activity: {formatLagosDateTime(first.lastMovementAt)}
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedCustomer({ id, name: first.customerName })}
                          >
                            Record or review
                          </Button>
                        </div>
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                          {customerRows.map((row) => (
                            <li key={`${row.customerId}:${row.typeId}`} className="flex flex-wrap justify-between gap-2 rounded bg-muted p-2 text-sm">
                              <span>{row.kind === "CRATE" ? "Crate" : "Bottle"} · {row.ownerName} · {row.label}</span>
                              <span className="font-medium tabular">{row.quantity} owed</span>
                              {row.valueKobo !== null && <Money kobo={row.valueKobo} tone="neutral" />}
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                  {balances.hasNextPage && (
                    <div className="flex justify-center">
                      <Button
                        variant="secondary"
                        loading={balances.isFetchingNextPage}
                        onClick={() => void balances.fetchNextPage()}
                      >
                        Load more customers
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
          <CustomerCratesPanel
            key={selectedCustomer?.id ?? "customer-picker"}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
          />
        </>
      )}
    </div>
  );
}
