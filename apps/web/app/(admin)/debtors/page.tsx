"use client";

import { useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { HandCoins, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { formatLagosDate, formatNaira } from "@fabtyna/shared";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { MoneyInput } from "@/components/money-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { accountingApi, debtorsApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { createIdempotencyIntent, type IdempotencyIntent } from "@/lib/api/idempotency-intent";
import { queryKeys } from "@/lib/query-keys";
import { confirm } from "@/stores/confirm-store";
import type { PaymentMethod } from "@fabtyna/shared";
import type { DebtorDto, DebtorSaleDto } from "@/lib/api/debtors.api";

const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "TRANSFER", "OTHER"];

export default function DebtorsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debtorFilter, setDebtorFilter] = useState<"all" | "minimum">("all");
  const [payingSaleId, setPayingSaleId] = useState<string | null>(null);
  const [paymentKobo, setPaymentKobo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const paymentIntent = useRef<IdempotencyIntent>(createIdempotencyIntent());
  const debouncedSearch = useDebouncedValue(search, 250);

  const debtors = useInfiniteQuery({
    queryKey: queryKeys.debtors.list(
      debouncedSearch,
      debtorFilter === "minimum" ? "100000" : undefined,
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      debtorsApi.list({
        search: debouncedSearch,
        minBalanceKobo: debtorFilter === "minimum" ? "100000" : undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const accounts = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listPaymentAccounts(),
    enabled: payingSaleId !== null,
  });
  const rows = debtors.data?.pages.flatMap((page) => page.items) ?? [];
  const grandTotal = debtors.data?.pages[0]?.grandTotalKobo ?? "0";
  const totalSales = rows.reduce((sum, debtor) => sum + debtor.sales.length, 0);
  const payMutation = useMutation({
    mutationFn: ({
      saleId,
      amountKobo,
      accountId: selectedAccountId,
      key,
    }: {
      saleId: string;
      amountKobo: string;
      accountId: string;
      key: string;
    }) =>
      debtorsApi.recordPayment(
        saleId,
        amountKobo,
        new Date().toISOString(),
        selectedAccountId,
        key,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.debtors.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all }),
      ]);
      paymentIntent.current.markSucceeded();
      setPayingSaleId(null);
      setPaymentKobo("");
      setAccountId("");
      setPaymentError("");
    },
  });

  function beginPayment(sale: DebtorSaleDto) {
    paymentIntent.current.reset();
    setPayingSaleId(sale.id);
    setPaymentKobo(sale.balanceDueKobo);
    setPaymentMethod("CASH");
    setAccountId("");
    setPaymentError("");
  }

  async function submitPayment(debtor: DebtorDto, sale: DebtorSaleDto) {
    setPaymentError("");
    if (!/^[0-9]+$/.test(paymentKobo.trim())) {
      setPaymentError("Enter a valid amount.");
      return;
    }
    const amount = BigInt(paymentKobo);
    const balance = BigInt(sale.balanceDueKobo);
    if (amount <= 0n || amount > balance) {
      setPaymentError(
        amount <= 0n
          ? "Enter an amount greater than zero."
          : `Payment cannot exceed the outstanding balance of ${formatNaira(balance)}.`,
      );
      return;
    }
    if (accounts.isError) {
      setPaymentError(`Accounts could not be loaded: ${toUserMessage(accounts.error)}`);
      return;
    }
    const selectedAccountId =
      accountId || defaultAccountId(accounts.data ?? [], paymentMethod);
    if (!selectedAccountId) {
      setPaymentError("Add an active account before recording this payment.");
      return;
    }
    await confirm({
      title: "Record this payment?",
      description: `Record ${formatNaira(amount)} received from ${debtor.name}?`,
      confirmLabel: "Record payment",
      onConfirm: async () => {
        try {
          await payMutation.mutateAsync({
            saleId: sale.id,
            amountKobo: amount.toString(),
            accountId: selectedAccountId,
            key: paymentIntent.current.getKey(),
          });
        } catch (error) {
          setPaymentError(toUserMessage(error));
        }
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Debtors"
        description="Customers with unpaid sales, across all periods."
        actions={
          <Link href="/sales" className={buttonClasses({ variant: "secondary" })}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New sale
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total outstanding"
          value={<Money kobo={grandTotal} tone="auto" />}
          tone={BigInt(grandTotal) > 0n ? "danger" : "default"}
          icon={HandCoins}
        />
        <StatCard label="Customers owing" value={rows.length} icon={Users} />
        <StatCard label="Unpaid sales on screen" value={totalSales} />
      </div>
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <label className="relative block">
            <span className="sr-only">Search debtors</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customers by name or phone"
              className="pl-9"
            />
          </label>
          <Select
            aria-label="Filter by outstanding amount"
            value={debtorFilter}
            onChange={(event) => setDebtorFilter(event.target.value as "all" | "minimum")}
          >
            <option value="all">Any outstanding balance</option>
            <option value="minimum">At least ₦1,000</option>
          </Select>
        </CardBody>
      </Card>
      {debtors.isPending ? (
        <Skeleton variant="row" count={5} />
      ) : debtors.isError ? (
        <ErrorState
          message={toUserMessage(debtors.error)}
          onRetry={() => void debtors.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No outstanding debts"
          description="No customer has an unpaid sale matching these filters."
          action={
            <Link href="/sales" className={buttonClasses({ variant: "secondary" })}>
              View sales
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((debtor) => (
            <Card key={debtor.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <Link
                    href={`/customers/${debtor.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {debtor.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {debtor.phone ?? "No phone"} · {debtor.sales.length} unpaid sale{debtor.sales.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total owed</p>
                  <Money kobo={debtor.balanceKobo} tone="auto" />
                </div>
              </div>
              <CardBody className="space-y-3">
                {debtor.sales.map((sale) => {
                  const isPaying = payingSaleId === sale.id;
                  return (
                    <div key={sale.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <Link href={`/sales/${sale.id}`} className="font-medium text-primary hover:underline">
                            {sale.reference ?? sale.id.slice(0, 8)}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {formatLagosDate(sale.soldAt)} · {sale.daysOutstanding} days outstanding
                          </p>
                        </div>
                        <div className="text-right">
                          <Money kobo={sale.balanceDueKobo} tone="auto" />
                          <p className="text-xs text-muted-foreground">
                            of <Money kobo={sale.totalKobo} tone="neutral" />
                          </p>
                        </div>
                      </div>
                      {sale.lines.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {sale.lines.map((line) => `${line.productName} ×${line.quantity} ${line.unit}`).join(", ")}
                        </p>
                      )}
                      {isPaying ? (
                        <div className="mt-3 space-y-3 border-t border-border pt-3">
                          <MoneyInput
                            id={`pay-${sale.id}`}
                            label="Payment amount"
                            defaultValueKobo={sale.balanceDueKobo}
                            onKoboChange={(value) => {
                              setPaymentKobo(value);
                              paymentIntent.current.reset();
                            }}
                          />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <FormField id={`method-${sale.id}`} label="Payment method">
                              <Select
                                id={`method-${sale.id}`}
                                value={paymentMethod}
                                onChange={(event) => {
                                  setPaymentMethod(event.target.value as PaymentMethod);
                                  setAccountId("");
                                  paymentIntent.current.reset();
                                }}
                              >
                                {PAYMENT_METHODS.map((method) => (
                                  <option key={method} value={method}>{method}</option>
                                ))}
                              </Select>
                            </FormField>
                            <AccountSelect
                              id={`account-${sale.id}`}
                              label="Received into"
                              accounts={accounts.data ?? []}
                              accountId={accountId}
                              onChange={(value) => {
                                setAccountId(value);
                                paymentIntent.current.reset();
                              }}
                              method={paymentMethod}
                              disabled={accounts.isPending || accounts.isError}
                            />
                          </div>
                          {accounts.isError && (
                            <p role="alert" className="text-sm text-danger">
                              Accounts could not be loaded: {toUserMessage(accounts.error)}
                            </p>
                          )}
                          {paymentError && <p role="alert" className="text-sm text-danger">{paymentError}</p>}
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => {
                                paymentIntent.current.reset();
                                setPayingSaleId(null);
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              disabled={payMutation.isPending || accounts.isPending || accounts.isError}
                              onClick={() => void submitPayment(debtor, sale)}
                            >
                              {payMutation.isPending ? "Saving…" : "Record payment"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex justify-end">
                          <Button size="sm" onClick={() => beginPayment(sale)}>
                            Record payment
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          ))}
          {debtors.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={debtors.isFetchingNextPage}
                onClick={() => void debtors.fetchNextPage()}
              >
                {debtors.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
