"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { MoneyFlowView } from "@/components/reports/money-flow-view";
import { ReportToolbar } from "@/components/reports/report-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatBps, parsePercentToBps } from "@/lib/bps";
import { queryKeys } from "@/lib/query-keys";
import { REPORT_STALE_MS, validateReportRange } from "@/lib/report-range";

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

  // Percent text becomes integer basis points by exact string parsing only.
  const discountParsed = parsePercentToBps(discountText);
  const collectibleParsed = parsePercentToBps(collectibleText);
  const debouncedDiscount = parsePercentToBps(
    useDebouncedValue(discountText, 400),
  );
  const debouncedCollectible = parsePercentToBps(
    useDebouncedValue(collectibleText, 400),
  );
  const assumptionsValid = debouncedDiscount.ok && debouncedCollectible.ok;
  const inputsValid = discountParsed.ok && collectibleParsed.ok;

  const options = {
    stockDiscountBps: debouncedDiscount.ok ? debouncedDiscount.bps : null,
    receivablesCollectibleBps: debouncedCollectible.ok
      ? debouncedCollectible.bps
      : null,
    includeReceivables,
    includeCash,
  };

  const positionQuery = useQuery({
    queryKey: queryKeys.reports.financialPosition({
      scenario: null,
      ...options,
    }),
    queryFn: () =>
      accountingApi.position({
        stockDiscountBps: options.stockDiscountBps ?? undefined,
        receivablesCollectibleBps: options.receivablesCollectibleBps ?? undefined,
        includeReceivables,
        includeCash,
      }),
    enabled: assumptionsValid,
    placeholderData: keepPreviousData,
    staleTime: REPORT_STALE_MS,
  });

  // Real accounts already carry their ledger-derived balance; only the demo store needs a sum.
  const accountBalancesQuery = useQuery({
    queryKey: queryKeys.accounting.accountBalances,
    queryFn: async () => {
      const accounts = await accountingApi.listAccounts();
      if (accounts.every((account) => account.balanceKobo !== undefined)) {
        return accounts.map((account) => ({
          account,
          balanceKobo: BigInt(account.balanceKobo ?? "0"),
        }));
      }
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
    staleTime: REPORT_STALE_MS,
  });
  const flowRangeError = validateReportRange(flowFrom, flowTo);
  const moneyFlowQuery = useQuery({
    queryKey: queryKeys.reports.moneyFlow(
      flowFrom,
      flowTo,
      flowAccountId || null,
    ),
    queryFn: () => accountingApi.moneyFlow(flowFrom, flowTo, flowAccountId || undefined),
    enabled: flowRangeError === null,
    staleTime: REPORT_STALE_MS,
  });

  if (positionQuery.isPending && assumptionsValid) {
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
  if (result === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Accounting"
          description="Can you clear everything you owe by selling your stock?"
        />
        <ErrorState
          title="Check the assumptions"
          message="Enter valid percentages (0 to 100, up to 2 decimals) to load the financial position."
        />
      </div>
    );
  }
  const sc = result.scenarios[scenario];

  const hasLiabilities = sc.totalLiabilitiesKobo > 0n;
  const shortfall =
    sc.netPositionKobo < 0n ? -sc.netPositionKobo : sc.netPositionKobo;

  // Bar widths are drawing proportions (0-100), not money; the amounts shown come from the server.
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

  const obligations = result.obligations;

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

      <div className="space-y-1">
        <ReportToolbar
          dataUpdatedAt={positionQuery.dataUpdatedAt}
          isFetching={positionQuery.isFetching}
          onRefresh={() => {
            void positionQuery.refetch();
            void accountBalancesQuery.refetch();
            void moneyFlowQuery.refetch();
          }}
        />
        <p className="text-xs text-muted-foreground">
          Current state only, no historical date. Cash is the sum of your
          account balances.
        </p>
      </div>

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
          <FormField
            id="discount"
            label="Stock discount %"
            error={discountParsed.ok ? undefined : discountParsed.error}
          >
            <input
              id="discount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={discountText}
              aria-invalid={!discountParsed.ok}
              onChange={(event) => setDiscountText(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-surface px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </FormField>
          <FormField
            id="collectible"
            label="Debtors collectible %"
            error={collectibleParsed.ok ? undefined : collectibleParsed.error}
          >
            <input
              id="collectible"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={collectibleText}
              aria-invalid={!collectibleParsed.ok}
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
              Percentages may have up to 2 decimals (for example 87.5). Discount
              applies to stock only. Debts are scaled by the collectible
              percentage.
              {!inputsValid && " Showing the last valid result until the input is fixed."}
              {positionQuery.isFetching && " Updating…"}
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
              <div>
                <dt className="font-medium text-foreground">
                  By supplier (credit purchases)
                </dt>
                <dd>
                  {result.liabilitiesBreakdown.payablesBySupplier.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      No unpaid supplier purchases.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {result.liabilitiesBreakdown.payablesBySupplier.map(
                        (line) => (
                          <li
                            key={line.supplierId}
                            className="flex items-center justify-between gap-3"
                          >
                            <Link
                              href="/accounting/payables"
                              className="text-primary hover:underline"
                            >
                              {line.supplierName}
                            </Link>
                            <Money kobo={line.amountKobo} tone="neutral" />
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">By lender (loans)</dt>
                <dd>
                  {result.liabilitiesBreakdown.loansByLender.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      No outstanding loans.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {result.liabilitiesBreakdown.loansByLender.map((line) => (
                        <li
                          key={line.loanId}
                          className="flex items-center justify-between gap-3"
                        >
                          <Link
                            href={`/accounting/loans/${line.loanId}`}
                            className="text-primary hover:underline"
                          >
                            {line.lenderName}
                          </Link>
                          <Money kobo={line.amountKobo} tone="neutral" />
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
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

          {flowRangeError !== null ? (
            <p role="alert" className="text-sm text-danger">
              {flowRangeError}
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
            <MoneyFlowView data={moneyFlowQuery.data} />
          )}
        </CardBody>
      </Card>

      {/* 7. Due soon and overdue */}
      <Card>
        <CardHeader
          title="Obligations"
          description="Up to 50 obligations, soonest due date first."
          action={
            <InfoHint label="How urgency is decided">
              Overdue means the due date has passed with a balance outstanding.
              Due soon means it falls within the next 7 days.
            </InfoHint>
          }
        />
        <CardBody>
          {obligations.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock aria-hidden="true" className="h-4 w-4" />
              No outstanding obligations.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {obligations.map((obligation) => (
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
                        obligation.urgency === "OVERDUE"
                          ? "danger"
                          : obligation.urgency === "DUE_IN_7_DAYS"
                            ? "warning"
                            : "neutral"
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
