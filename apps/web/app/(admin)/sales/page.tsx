"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Plus, Receipt, Search } from "lucide-react";
import Link from "next/link";
import {
  formatNaira,
  getLagosBusinessDayRange,
  type SaleChannel,
  type SaleStatus,
} from "@fabtyna/shared";
import { ListEmpty, ListError, ListLoading } from "@/components/list-feedback";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { expensesApi, productsApi, salesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SaleListItemDto } from "@/lib/api/sales.api";

const CHANNELS: (SaleChannel | "ALL")[] = ["ALL", "RETAIL", "WHOLESALE"];
const STATUSES: (SaleStatus | "ALL")[] = [
  "ALL",
  "DRAFT",
  "COMPLETED",
  "VOIDED",
];

export default function SalesPage() {
  const [filterChannel, setFilterChannel] = useState<SaleChannel | "ALL">(
    "ALL",
  );
  const [filterStatus, setFilterStatus] = useState<SaleStatus | "ALL">("ALL");
  const [filterSearch, setFilterSearch] = useState("");

  const sales = useQuery({
    queryKey: queryKeys.sales.list,
    queryFn: () => salesApi.list(),
  });

  const expenses = useQuery({
    queryKey: queryKeys.expenses.list(),
    queryFn: () => expensesApi.list(),
  });

  const products = useQuery({
    queryKey: queryKeys.products.list("", false),
    queryFn: () => productsApi.list({ search: "", includeDeleted: false }),
  });

  const queryClient = useQueryClient();

  const [showDebtorForm, setShowDebtorForm] = useState(false);
  const [debtorName, setDebtorName] = useState("");
  const [debtorProductId, setDebtorProductId] = useState("");
  const [debtorQty, setDebtorQty] = useState("");
  const [debtorPrice, setDebtorPrice] = useState("");

  const createDebtorMutation = useMutation({
    mutationFn: () =>
      salesApi.create({
        customerId: null,
        customerName: debtorName.trim(),
        channel: "RETAIL",
        location: "RETAIL_SHELF",
        soldAt: new Date().toISOString(),
        notes: null,
        reference: null,
        paidKobo: "0",
        lines: [
          {
            productId: debtorProductId,
            unit: "UNIT",
            quantity: Number(debtorQty),
            unitPriceKobo: debtorPrice,
          },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      setShowDebtorForm(false);
      setDebtorName("");
      setDebtorProductId("");
      setDebtorQty("");
      setDebtorPrice("");
    },
  });

  // Business day follows Africa/Lagos time and rolls over automatically.
  const businessDate = useLagosBusinessDate();
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
    return (sales.data ?? []).filter((sale) => {
      if (filterChannel !== "ALL" && sale.channel !== filterChannel)
        return false;
      if (filterStatus !== "ALL" && sale.status !== filterStatus) return false;
      if (query !== "") {
        const haystack =
          `${sale.customerName ?? ""} ${sale.reference ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [sales.data, filterChannel, filterStatus, filterSearch]);

  const debtors = useMemo(() => {
    return (sales.data ?? []).filter(
      (sale) =>
        sale.status !== "VOIDED" &&
        BigInt(sale.totalKobo) - BigInt(sale.paidKobo) > 0n,
    );
  }, [sales.data]);

  const totalDebt = debtors.reduce(
    (sum, s) => sum + (BigInt(s.totalKobo) - BigInt(s.paidKobo)),
    0n,
  );

  const recentExpenses = useMemo(
    () => (expenses.data ?? []).slice(0, 5),
    [expenses.data],
  );

  const totalExpenses = (expenses.data ?? []).reduce(
    (sum, e) => sum + BigInt(e.amountKobo),
    0n,
  );

  const columns: ResponsiveTableColumn<SaleListItemDto>[] = [
    {
      header: "Date",
      render: (sale) => new Date(sale.soldAt).toLocaleDateString("en-NG"),
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
        <span
          className={
            sale.channel === "RETAIL"
              ? "text-blue-700 dark:text-blue-400"
              : "text-purple-700 dark:text-purple-400"
          }
        >
          {sale.channel === "RETAIL" ? "Retail (fridge)" : "Wholesale"}
        </span>
      ),
    },
    {
      header: "Customer",
      render: (sale) => sale.customerName ?? "Walk-in",
    },
    {
      header: "Lines",
      render: (sale) => sale.lineCount.toString(),
    },
    {
      header: "Total",
      render: (sale) => formatNaira(sale.totalKobo),
    },
    {
      header: "Paid",
      render: (sale) => formatNaira(sale.paidKobo),
    },
    {
      header: "Status",
      render: (sale) => (
        <span
          className={
            sale.status === "VOIDED"
              ? "text-destructive"
              : sale.status === "COMPLETED"
                ? "text-green-700 dark:text-green-400"
                : ""
          }
        >
          {sale.status}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Retail (fridge) and wholesale sales.
          </p>
        </div>
        <Link
          href="/sales/new"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New sale
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Today — retail</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(stats.todayRetail.toString())}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Today — wholesale</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(stats.todayWholesale.toString())}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Yesterday — retail</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(stats.yesterdayRetail.toString())}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Yesterday — wholesale</p>
          <p className="mt-1 text-xl font-semibold">
            {formatNaira(stats.yesterdayWholesale.toString())}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Recent expenses</h2>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/expenses/new"
                className="text-sm text-primary hover:underline"
              >
                Add
              </Link>
              <Link
                href="/expenses"
                className="text-sm text-muted-foreground hover:underline"
              >
                View all
              </Link>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Total: {formatNaira(totalExpenses.toString())}
          </p>
          {expenses.isPending ? (
            <ListLoading />
          ) : recentExpenses.length === 0 ? (
            <ListEmpty message="No expenses recorded." />
          ) : (
            <ul className="mt-3 space-y-2">
              {recentExpenses.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.channel === "RETAIL"
                        ? "Retail"
                        : e.channel === "WHOLESALE"
                          ? "Wholesale"
                          : "Both"}{" "}
                      · {new Date(e.expenseDate).toLocaleDateString("en-NG")}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium">
                    {formatNaira(e.amountKobo)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Debtors</h2>
            </div>
            <Link
              href="/debtors"
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Outstanding: {formatNaira(totalDebt.toString())}
          </p>

          <button
            type="button"
            onClick={() => setShowDebtorForm((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            {showDebtorForm ? "Cancel" : "Record retail debtor"}
          </button>

          {showDebtorForm && (
            <div className="mt-3 space-y-2 rounded-md border border-border bg-background/50 p-3">
              <input
                type="text"
                value={debtorName}
                onChange={(e) => setDebtorName(e.target.value)}
                placeholder="Customer name (not stored)"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <select
                value={debtorProductId}
                onChange={(e) => setDebtorProductId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select product</option>
                {products.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={debtorQty}
                  onChange={(e) => setDebtorQty(e.target.value)}
                  placeholder="Qty"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <input
                  type="text"
                  value={debtorPrice}
                  onChange={(e) => setDebtorPrice(e.target.value)}
                  placeholder="Price (kobo)"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {createDebtorMutation.error && (
                <p className="text-xs text-destructive">
                  {createDebtorMutation.error.message}
                </p>
              )}
              <button
                type="button"
                disabled={
                  !debtorName.trim() ||
                  !debtorProductId ||
                  !debtorQty ||
                  !debtorPrice ||
                  createDebtorMutation.isPending
                }
                onClick={() => createDebtorMutation.mutate()}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {createDebtorMutation.isPending
                  ? "Recording…"
                  : "Record debtor"}
              </button>
            </div>
          )}

          {sales.isPending ? (
            <ListLoading />
          ) : debtors.length === 0 ? (
            <ListEmpty message="No outstanding debts." />
          ) : (
            <ul className="mt-3 space-y-2">
              {debtors.slice(0, 5).map((s) => {
                const owed = BigInt(s.totalKobo) - BigInt(s.paidKobo);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {s.customerName ?? "Walk-in"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.channel === "RETAIL" ? "Retail" : "Wholesale"} ·{" "}
                        {new Date(s.soldAt).toLocaleDateString("en-NG")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-destructive">
                        {formatNaira(owed.toString())}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        of {formatNaira(s.totalKobo)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="f-search" className="block text-sm font-medium">
              Search
            </label>
            <div className="flex min-h-12 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-1 focus-within:ring-ring">
              <Search
                aria-hidden="true"
                className="h-4 w-4 text-muted-foreground"
              />
              <input
                id="f-search"
                type="search"
                value={filterSearch}
                onChange={(event) => setFilterSearch(event.target.value)}
                placeholder="Customer name or reference"
                className="min-w-0 flex-1 bg-transparent text-base outline-none"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-channel" className="block text-sm font-medium">
              Channel
            </label>
            <select
              id="f-channel"
              value={filterChannel}
              onChange={(event) =>
                setFilterChannel(event.target.value as SaleChannel | "ALL")
              }
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
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
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-status" className="block text-sm font-medium">
              Status
            </label>
            <select
              id="f-status"
              value={filterStatus}
              onChange={(event) =>
                setFilterStatus(event.target.value as SaleStatus | "ALL")
              }
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st === "ALL" ? "All statuses" : st}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sales.isPending ? (
          <ListLoading />
        ) : sales.isError ? (
          <ListError
            message={sales.error.message || "Sales could not be loaded."}
            retry={() => void sales.refetch()}
          />
        ) : filtered.length === 0 ? (
          <ListEmpty message="No sales match these filters." />
        ) : (
          <ResponsiveTable
            rows={filtered}
            columns={columns}
            getKey={(sale) => sale.id}
          />
        )}
      </section>
    </div>
  );
}
