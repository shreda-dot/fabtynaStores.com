"use client";

import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import type { MoneyFlowReportDto } from "@/lib/api/accounting.api";
import { flowCategoryLabel } from "@/lib/money-flow-labels";

function FlowSummary({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-foreground">
        <Money kobo={amount} />
      </p>
    </div>
  );
}

/** True when a sale or debt payment was reversed inside the period (money out on those entry types). */
export function hasReversedPayment(data: MoneyFlowReportDto): boolean {
  return data.rows.some((row) =>
    row.categories.some(
      (category) =>
        (category.key === "SALE_PAYMENT" || category.key === "CUSTOMER_PAYMENT") &&
        BigInt(category.moneyOutKobo) > 0n,
    ),
  );
}

/**
 * Renders a money-flow report exactly as the server (or demo store) returned
 * it. Nothing here recomputes a number.
 */
export function MoneyFlowView({ data }: { data: MoneyFlowReportDto }) {
  const reversed = hasReversedPayment(data);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {data.totalsExcludeTransfers ? (
          <Badge tone="success">Totals exclude transfers</Badge>
        ) : (
          <Badge tone="warning">Demo totals include transfers</Badge>
        )}
        <p className="text-xs text-muted-foreground">
          {data.totalsExcludeTransfers
            ? "Transfers between your own accounts are shown separately below."
            : "Demo data: these totals include money moved between accounts. The real server leaves transfers out of the totals."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FlowSummary
          label="Opening balance"
          amount={data.totals.openingBalanceKobo}
        />
        <FlowSummary label="Money in" amount={data.totals.moneyInKobo} />
        <FlowSummary label="Money out" amount={data.totals.moneyOutKobo} />
        <FlowSummary
          label="Closing balance"
          amount={data.totals.closingBalanceKobo}
        />
      </div>

      {data.transfers && (
        <div className="rounded-md border border-border p-4">
          <h3 className="font-semibold">Transfers between your accounts</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Moving money from one account to another is not income or spending,
            so it is not in the totals above.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <FlowSummary label="Transferred in" amount={data.transfers.moneyInKobo} />
            <FlowSummary label="Transferred out" amount={data.transfers.moneyOutKobo} />
          </dl>
        </div>
      )}

      <div className="rounded-md border border-border p-4">
        <h3 className="font-semibold">Sales story</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Billed and debt are for non-voided sales made in this date range. Cash
          received is the net of sale and debt payments posted in this range.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FlowSummary label="Sales billed" amount={data.sales.billedKobo} />
          <FlowSummary
            label="Cash received from sales"
            amount={data.sales.customerMoneyReceivedKobo}
          />
          <FlowSummary
            label="Debt still owed on these sales"
            amount={data.sales.debtOutstandingKobo}
          />
          {data.sales.debtsOwedNowKobo !== undefined && (
            <FlowSummary
              label="All customer debt owed now (as of now)"
              amount={data.sales.debtsOwedNowKobo}
            />
          )}
        </dl>
        <p
          className={
            reversed
              ? "mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
              : "mt-3 text-xs text-muted-foreground"
          }
          role={reversed ? "note" : undefined}
        >
          {reversed
            ? "This period contains a reversed payment. Money flow dates a reversal on the day it was reversed, so cash received here can differ from the Sales summary, which ignores reversed payments entirely."
            : "If a payment is ever reversed, Money flow shows the reversal on its own day, so cash received can differ from the Sales summary."}
        </p>
      </div>

      <div className="space-y-4">
        {data.rows.map((row) => (
          <section
            key={row.accountId}
            className="rounded-md border border-border p-4"
          >
            <h3 className="mb-3 font-semibold">
              {row.accountName}{" "}
              <span className="text-xs text-muted-foreground">
                ({row.accountType})
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3">Balance</th>
                    <th className="py-2 pr-3 text-right">Opening</th>
                    <th className="py-2 pr-3 text-right">Money in</th>
                    <th className="py-2 pr-3 text-right">Money out</th>
                    <th className="py-2 text-right">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2 pr-3 font-medium">Account</td>
                    <td className="py-2 pr-3 text-right">
                      <Money kobo={row.openingBalanceKobo} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Money kobo={row.moneyInKobo} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Money kobo={row.moneyOutKobo} />
                    </td>
                    <td className="py-2 text-right font-semibold">
                      <Money kobo={row.closingBalanceKobo} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3 text-right">Money in</th>
                    <th className="py-2 text-right">Money out</th>
                  </tr>
                </thead>
                <tbody>
                  {row.categories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-3 text-muted-foreground">
                        No money movement in this date range.
                      </td>
                    </tr>
                  ) : (
                    row.categories.map((category) => (
                      <tr
                        key={category.key}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="py-2 pr-3">
                          {flowCategoryLabel(category.key)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Money kobo={category.moneyInKobo} />
                        </td>
                        <td className="py-2 text-right">
                          <Money kobo={category.moneyOutKobo} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
