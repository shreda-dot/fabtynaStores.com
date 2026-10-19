"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  Landmark,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  FINANCIAL_POSITION_SCENARIOS,
  formatLagosDate,
  type FinancialPositionScenario,
} from "@fabtyna/shared";
import { InfoHint } from "@/components/info-hint";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { accountingApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

const SCENARIO_LABELS: Record<FinancialPositionScenario, string> = {
  EXPECTED: "Expected",
  BEST: "Best case",
  FLOOR: "Floor (at cost)",
};

const SCENARIO_HINTS: Record<FinancialPositionScenario, string> = {
  EXPECTED: "Warehouse packs at wholesale price, shelf units at retail.",
  BEST: "Every unit sold at retail price.",
  FLOOR: "Every unit sold at cost — the least you would get.",
};

const URGENCY_LABEL = {
  OVERDUE: "Overdue",
  DUE_IN_7_DAYS: "Due soon",
  LATER: "Later",
} as const;

const FLOW_CATEGORY_LABELS: Record<string, string> = {
  SALE_PAYMENT: "Sale payments",
  CUSTOMER_PAYMENT: "Customer debt payments",
  SUPPLIER_PAYMENT: "Supplier payments",
  PURCHASE_PAYMENT: "Supplier-less purchases",
  EXPENSE: "Expenses",
  CUSTOMER_REFUND: "Customer refunds",
  TRANSFER_IN: "Transfers in",
  TRANSFER_OUT: "Transfers out",
  OWNER_CAPITAL: "Owner contributions",
  OWNER_DRAWING: "Owner withdrawals",
  OTHER_INCOME: "Other income",
  BANK_OR_POS_CHARGE: "Bank / POS charges",
  ADJUSTMENT: "Reconciliation adjustments",
  OPENING_BALANCE: "Opening balance",
  LOAN_DISBURSEMENT: "Loans received",
  LOAN_REPAYMENT: "Loan repayments",
};

function flowCategoryLabel(key: string): string {
  if (key.startsWith("EXPENSE:")) {
    const category = key.slice("EXPENSE:".length).toLocaleLowerCase();
    return `${category.charAt(0).toLocaleUpperCase()}${category.slice(1)} expenses`;
  }
  return FLOW_CATEGORY_LABELS[key] ?? key;
}

function clampPercentText(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return 0;
  const value = Number.parseInt(digits, 10);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(0)}%`;
}

export default function AccountingOverviewPage() {
  const businessDate = useLagosBusinessDate();

  const [discountText, setDiscountText] = useState("0");
  const [collectibleText, setCollectibleText] = useState("100");
  const [includeReceivables, setIncludeReceivables] = useState(true);
  const [includeCash, setIncludeCash] = useState(true);
  const [scenario, setScenario] =
    useState<FinancialPositionScenario>("EXPECTED");
  const [flowFrom, setFlowFrom] = useState(() => `${businessDate.slice(0, 7)}-01`);
  const [flowTo, setFlowTo] = useState(businessDate);
  const [flowAccountId, setFlowAccountId] = useState("");

  const options = {
    stockDiscountBps: clampPercentText(discountText) * 100,
    receivablesCollectibleBps: clampPercentText(collectibleText) * 100,
    includeReceivables,
    includeCash,
  };

  const positionQuery = useQuery({
    queryKey: queryKeys.accounting.position(options),
    queryFn: () => accountingApi.position(options),
  });

  const accountBalancesQuery = useQuery({
    queryKey: queryKeys.accounting.accountBalances,
    queryFn: async () => {
      const accounts = await accountingApi.listAccounts();
      const ledgers = await Promise.all(
        accounts.map((account) => accountingApi.listLedgerEntries(account.id)),
      );
      return accounts.map((account, index) => ({
        account,
        balanceKobo: ledgers[index].reduce(
          (balance, entry) => balance + BigInt(entry.amountKobo),
          0n,
        ),
      }));
    },
  });
  const moneyFlowQuery = useQuery({
    queryKey: queryKeys.accounting.moneyFlow(
      flowFrom,
      flowTo,
      flowAccountId,
    ),
    queryFn: () => accountingApi.moneyFlow(flowFrom, flowTo, flowAccountId || undefined),
    enabled: flowFrom !== "" && flowTo !== "" && flowFrom <= flowTo,
  });

  if (positionQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" count={2} className="max-w-sm" />
        <Skeleton variant="card" count={1} className="lg:grid-cols-1" />
        <Skeleton variant="stat" count={3} />
        <Skeleton variant="row" count={4} />
      </div>
    );
  }

  if (positionQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Accounting"
          description="Can you clear everything you owe by selling your stock?"
        />
        <ErrorState
          title="Financial position could not be loaded"
          message={toUserMessage(positionQuery.error)}
          onRetry={() => void positionQuery.refetch()}
        />
      </div>
    );
  }

  const result = positionQuery.data;
  const sc = result.scenarios[scenario];

  const supplierPayablesKobo =
    result.liabilitiesBreakdown.payablesBySupplier.reduce(
      (sum, line) => sum + line.amountKobo,
      0n,
    );
  const loansOutstandingKobo = result.liabilitiesBreakdown.loansByLender.reduce(
    (sum, line) => sum + line.amountKobo,
    0n,
  );

  const hasLiabilities = sc.totalLiabilitiesKobo > 0n;
  const shortfall =
    sc.netPositionKobo < 0n ? -sc.netPositionKobo : sc.netPositionKobo;

  const barMax =
    sc.totalAssetsKobo > sc.totalLiabilitiesKobo
      ? sc.totalAssetsKobo
      : sc.totalLiabilitiesKobo;
  const assetsWidth =
    barMax === 0n
      ? 0
      : Math.min(100, Number((sc.totalAssetsKobo * 100n) / barMax));
  const liabilitiesWidth =
    barMax === 0n
      ? 0
      : Math.min(100, Number((sc.totalLiabilitiesKobo * 100n) / barMax));

  const urgentObligations = result.obligations
    .filter((obligation) => obligation.urgency !== "LATER")
    .sort((a, b) => {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    })
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description="Can you clear everything you owe by selling your stock?"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/accounting/payables"
              className={buttonClasses({ variant: "secondary" })}
            >
              Payables
            </Link>
            <Link
              href="/accounting/loans"
              className={buttonClasses({ variant: "secondary" })}
            >
              Loans
            </Link>
          </div>
        }
      />

      {/* 1. Headline verdict */}
      <Card
        className={
          hasLiabilities && !sc.canClearAll
            ? "border-danger/40"
            : "border-success/40"
        }
      >
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {FINANCIAL_POSITION_SCENARIOS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setScenario(value)}
                aria-pressed={scenario === value}
                className={buttonClasses({
                  variant: scenario === value ? "primary" : "secondary",
                  size: "sm",
                })}
              >
                {SCENARIO_LABELS[value]}
              </button>
            ))}
          </div>

          <div className="flex items-start gap-3">
            {hasLiabilities && !sc.canClearAll ? (
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-6 w-6 shrink-0 text-danger"
              />
            ) : (
              <BadgeCheck
                aria-hidden="true"
                className="mt-0.5 h-6 w-6 shrink-0 text-success"
              />
            )}
            <div className="min-w-0">
              {!hasLiabilities ? (
                <p className="text-lg font-semibold text-success">
                  You owe nothing. Selling stock would leave you{" "}
                  <Money kobo={sc.totalAssetsKobo} className="font-semibold" />{" "}
                  in assets.
                </p>
              ) : sc.canClearAll ? (
                <p className="text-lg font-semibold text-success">
                  Selling all stock would clear everything you owe, with{" "}
                  <Money kobo={shortfall} className="font-semibold" /> left
                  over.
                </p>
              ) : (
                <p className="text-lg font-semibold text-danger">
                  Selling all stock would leave you{" "}
                  <Money kobo={shortfall} className="font-semibold" /> short.
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {SCENARIO_HINTS[scenario]} Based on current listed prices. Real
                results depend on actually selling at these prices.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 2. Controls */}
      <Card>
        <CardHeader
          title="Assumptions"
          description="Change these to see how the position moves."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="discount" label="Stock discount %">
            <input
              id="discount"
              type="number"
              min="0"
              max="100"
              inputMode="numeric"
              value={discountText}
              onChange={(event) => setDiscountText(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-surface px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </FormField>
          <FormField id="collectible" label="Debtors collectible %">
            <input
              id="collectible"
              type="number"
              min="0"
              max="100"
              inputMode="numeric"
              value={collectibleText}
              onChange={(event) => setCollectibleText(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-surface px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </FormField>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={includeReceivables}
                onChange={(event) =>
                  setIncludeReceivables(event.target.checked)
                }
                className="h-4 w-4"
              />
              Include customer debts
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={includeCash}
                onChange={(event) => setIncludeCash(event.target.checked)}
                className="h-4 w-4"
              />
              Include cash
            </label>
          </div>
          <div className="flex items-end pb-1 text-xs text-muted-foreground sm:col-span-2 lg:col-span-1">
            <span>
              Discount applies to stock only. Debts are scaled by the
              collectible percentage.
            </span>
          </div>
        </CardBody>
      </Card>

      {/* 3. Assets / Liabilities columns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Assets" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Stock value">
                <Money kobo={sc.stockValueKobo} tone="neutral" />
              </SummaryRow>
              <SummaryRow label="Customer debts">
                <Money kobo={sc.receivablesKobo} tone="neutral" />
              </SummaryRow>
              <SummaryRow label="Cash">
                <Money kobo={sc.cashKobo} tone="neutral" />
              </SummaryRow>
              <div className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-2">
                <dt className="font-semibold text-foreground">Total assets</dt>
                <dd className="font-semibold text-foreground">
                  <Money kobo={sc.totalAssetsKobo} tone="neutral" />
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Liabilities"
            action={
              <InfoHint label="What counts as a liability">
                Money you owe: unpaid supplier purchases (payables) and
                outstanding loans. These are exact sums — never discounted.
              </InfoHint>
            }
          />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Supplier credit">
                <Link
                  href="/accounting/payables"
                  className="text-primary hover:underline"
                >
                  <Money kobo={supplierPayablesKobo} tone="neutral" />
                </Link>
              </SummaryRow>
              <SummaryRow label="Loans">
                <Link
                  href="/accounting/loans"
                  className="text-primary hover:underline"
                >
                  <Money kobo={loansOutstandingKobo} tone="neutral" />
                </Link>
              </SummaryRow>
              <div className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-2">
                <dt className="font-semibold text-foreground">
                  Total liabilities
                </dt>
                <dd className="font-semibold text-foreground">
                  <Money kobo={sc.totalLiabilitiesKobo} tone="neutral" />
                </dd>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-2">
                <dt className="font-semibold text-foreground">Net position</dt>
                <dd className="font-semibold">
                  <Money kobo={sc.netPositionKobo} />
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* 4. Coverage bar */}
      <Card>
        <CardHeader
          title="Coverage"
          description="How much of what you owe your assets can cover."
        />
        <CardBody className="space-y-4">
          <div className="space-y-3">
            <BarRow
              label="Assets"
              value={sc.totalAssetsKobo}
              width={assetsWidth}
              tone="bg-primary"
            />
            <BarRow
              label="Liabilities"
              value={sc.totalLiabilitiesKobo}
              width={liabilitiesWidth}
              tone="bg-danger"
            />
          </div>
          <p className="text-sm text-foreground">
            {sc.coverageBps === null ? (
              <>No liabilities — nothing to cover.</>
            ) : (
              <>
                Assets cover <strong>{formatBps(sc.coverageBps)}</strong> of
                what you owe. Stock alone covers{" "}
                <strong>{formatBps(sc.stockOnlyCoverageBps)}</strong>.
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Stock-only net after clearing debts:{" "}
            <Money kobo={sc.stockOnlyNetKobo} />
          </p>
        </CardBody>
      </Card>

      {/* 5. Scenario comparison */}
      <Card>
        <CardHeader
          title="All three scenarios"
          description="Compare at a glance. Assets round down; liabilities are exact."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Scenario</th>
                <th className="py-2 pr-3 text-right font-medium">
                  Stock value
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  Total assets
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  Net position
                </th>
                <th className="py-2 font-medium">Can clear all?</th>
              </tr>
            </thead>
            <tbody>
              {FINANCIAL_POSITION_SCENARIOS.map((value) => {
                const row = result.scenarios[value];
                return (
                  <tr
                    key={value}
                    className="border-b border-border last:border-0"
                  >
                    <td className="py-2 pr-3 font-medium text-foreground">
                      {SCENARIO_LABELS[value]}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Money kobo={row.stockValueKobo} tone="neutral" />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Money kobo={row.totalAssetsKobo} tone="neutral" />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Money kobo={row.netPositionKobo} />
                    </td>
                    <td className="py-2">
                      {row.canClearAll ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <Badge tone="danger">No</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cash and bank balances"
          description="Current balances are the sum of each account’s immutable ledger entries. Count and reconcile accounts to update them."
          action={
            <Link
              href="/accounting/accounts"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Manage accounts
            </Link>
          }
        />
        <CardBody>
          {accountBalancesQuery.isPending ? (
            <Skeleton variant="row" count={2} />
          ) : accountBalancesQuery.isError ? (
            <ErrorState
              title="Account balances could not be loaded"
              message={toUserMessage(accountBalancesQuery.error)}
              onRetry={() => void accountBalancesQuery.refetch()}
            />
          ) : accountBalancesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts yet. Create an account to track money held by the business.
            </p>
          ) : (
            <div className="space-y-3">
              {accountBalancesQuery.data.map(({ account, balanceKobo }) => (
                <div
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-sm text-foreground">
                    {account.name}
                    {!account.isActive && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (deactivated)
                      </span>
                    )}
                  </span>
                  <Money kobo={balanceKobo} className="font-semibold" />
                </div>
              ))}
              <p className="flex justify-between border-t border-border pt-3 font-semibold">
                <span>Total across accounts</span>
                <Money
                  kobo={accountBalancesQuery.data.reduce(
                    (sum, row) => sum + row.balanceKobo,
                    0n,
                  )}
                />
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Manual cash snapshots remain available as historical records only; they do not change account balances or financial position.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Money flow"
          description="See how account balances changed and compare sales billed with customer money received and debt still owed."
        />
        <CardBody className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="money-flow-from" label="From">
              <Input
                id="money-flow-from"
                type="date"
                value={flowFrom}
                max={businessDate}
                onChange={(event) => setFlowFrom(event.target.value)}
              />
            </FormField>
            <FormField id="money-flow-to" label="To">
              <Input
                id="money-flow-to"
                type="date"
                value={flowTo}
                min={flowFrom}
                max={businessDate}
                onChange={(event) => setFlowTo(event.target.value)}
              />
            </FormField>
            <FormField id="money-flow-account" label="Account">
              <Select
                id="money-flow-account"
                value={flowAccountId}
                onChange={(event) => setFlowAccountId(event.target.value)}
              >
                <option value="">All accounts</option>
                {(accountBalancesQuery.data ?? []).map(({ account }) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {flowFrom === "" || flowTo === "" || flowFrom > flowTo ? (
            <p role="alert" className="text-sm text-danger">
              Choose a valid date range.
            </p>
          ) : moneyFlowQuery.isPending ? (
            <Skeleton variant="row" count={4} />
          ) : moneyFlowQuery.isError ? (
            <ErrorState
              title="Money flow could not be loaded"
              message={toUserMessage(moneyFlowQuery.error)}
              onRetry={() => void moneyFlowQuery.refetch()}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <FlowSummary
                  label="Opening balance"
                  amount={moneyFlowQuery.data.totals.openingBalanceKobo}
                />
                <FlowSummary
                  label="Money in"
                  amount={moneyFlowQuery.data.totals.moneyInKobo}
                />
                <FlowSummary
                  label="Money out"
                  amount={moneyFlowQuery.data.totals.moneyOutKobo}
                />
                <FlowSummary
                  label="Closing balance"
                  amount={moneyFlowQuery.data.totals.closingBalanceKobo}
                />
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="font-semibold">Sales and customer collections</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sales billed and outstanding are for non-voided sales made in this date range. Customer money received is the net of sale and debt payments (including reversals) posted to the selected account(s) in this range.
                </p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <FlowSummary
                    label="Sales billed"
                    amount={moneyFlowQuery.data.sales.billedKobo}
                  />
                  <FlowSummary
                    label="Customer money received"
                    amount={moneyFlowQuery.data.sales.customerMoneyReceivedKobo}
                  />
                  <FlowSummary
                    label="Debt still owed on these sales"
                    amount={moneyFlowQuery.data.sales.debtOutstandingKobo}
                  />
                </dl>
              </div>

              <div className="space-y-4">
                {moneyFlowQuery.data.rows.map((row) => (
                  <section
                    key={row.accountId}
                    className="rounded-md border border-border p-4"
                  >
                    <h3 className="mb-3 font-semibold">
                      {row.accountName} <span className="text-xs text-muted-foreground">({row.accountType})</span>
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
                            <td className="py-2 pr-3 text-right"><Money kobo={row.openingBalanceKobo} /></td>
                            <td className="py-2 pr-3 text-right"><Money kobo={row.moneyInKobo} /></td>
                            <td className="py-2 pr-3 text-right"><Money kobo={row.moneyOutKobo} /></td>
                            <td className="py-2 text-right font-semibold"><Money kobo={row.closingBalanceKobo} /></td>
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
                              <tr key={category.key} className="border-b border-border/60 last:border-0">
                                <td className="py-2 pr-3">{flowCategoryLabel(category.key)}</td>
                                <td className="py-2 pr-3 text-right"><Money kobo={category.moneyInKobo} /></td>
                                <td className="py-2 text-right"><Money kobo={category.moneyOutKobo} /></td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* 7. Due soon and overdue */}
      <Card>
        <CardHeader
          title="Due soon and overdue"
          description="Obligations to settle first."
          action={
            <InfoHint label="How urgency is decided">
              Overdue means the due date has passed with a balance outstanding.
              Due soon means it falls within the next 7 days.
            </InfoHint>
          }
        />
        <CardBody>
          {urgentObligations.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock aria-hidden="true" className="h-4 w-4" />
              Nothing is overdue or due in the next 7 days.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {urgentObligations.map((obligation) => (
                <li
                  key={`${obligation.kind}-${obligation.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {obligation.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {obligation.dueDate === null
                        ? "No due date"
                        : `Due ${formatLagosDate(obligation.dueDate)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money
                      kobo={obligation.balanceKobo}
                      className="font-medium"
                    />
                    <Badge
                      tone={
                        obligation.urgency === "OVERDUE" ? "danger" : "warning"
                      }
                    >
                      {URGENCY_LABEL[obligation.urgency]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/accounting/payables"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Wallet aria-hidden="true" className="h-4 w-4" />
              All payables
            </Link>
            <Link
              href="/accounting/loans"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Landmark aria-hidden="true" className="h-4 w-4" />
              All loans
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

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

function BarRow({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string | bigint;
  width: number;
  tone: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <Money kobo={value} className="font-medium" />
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}
