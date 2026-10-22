"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoneyFlowView } from "@/components/reports/money-flow-view";
import {
  EffectiveRange,
  ReportRangeFields,
} from "@/components/reports/report-range";
import { ReportTabs } from "@/components/reports/report-tabs";
import { ReportToolbar } from "@/components/reports/report-toolbar";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { accountingApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { REPORT_STALE_MS, validateReportRange } from "@/lib/report-range";

export default function MoneyFlowReportPage() {
  const businessDate = useLagosBusinessDate();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [accountId, setAccountId] = useState("");

  const from = range?.from ?? `${businessDate.slice(0, 7)}-01`;
  const to = range?.to ?? businessDate;
  const rangeError = validateReportRange(from, to);

  const accountsQuery = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
    staleTime: REPORT_STALE_MS,
  });

  const report = useQuery({
    queryKey: queryKeys.reports.moneyFlow(from, to, accountId || null),
    queryFn: () => accountingApi.moneyFlow(from, to, accountId || undefined),
    enabled: rangeError === null,
    staleTime: REPORT_STALE_MS,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Money flow"
        description="How each account’s balance changed, and how sales turned into cash."
      />
      <ReportTabs />

      <Card>
        <CardBody className="space-y-4">
          <ReportRangeFields
            idPrefix="money-flow"
            from={from}
            to={to}
            businessDate={businessDate}
            error={rangeError}
            onChange={(nextFrom, nextTo) =>
              setRange({ from: nextFrom, to: nextTo })
            }
          />
          <div className="max-w-xs">
            <FormField id="money-flow-account" label="Account">
              <Select
                id="money-flow-account"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">All accounts</option>
                {(accountsQuery.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.isActive ? "" : " (deactivated)"}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </CardBody>
      </Card>

      {rangeError !== null ? (
        <ErrorState title="Check the date range" message={rangeError} />
      ) : report.isPending ? (
        <div className="space-y-4">
          <Skeleton variant="stat" count={4} />
          <Skeleton variant="row" count={4} />
        </div>
      ) : report.isError ? (
        <ErrorState
          title="Money flow could not be loaded"
          message={toUserMessage(report.error)}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <>
          <div className="space-y-2">
            <ReportToolbar
              dataUpdatedAt={report.dataUpdatedAt}
              isFetching={report.isFetching}
              onRefresh={() => void report.refetch()}
            />
            {report.data.from !== undefined && report.data.to !== undefined && (
              <EffectiveRange from={report.data.from} to={report.data.to} />
            )}
          </div>
          {report.data.rows.length === 0 ? (
            <EmptyState
              title="No accounts to report on"
              description="Create an account under Accounting to start tracking money."
            />
          ) : (
            <MoneyFlowView data={report.data} />
          )}
        </>
      )}
    </div>
  );
}
