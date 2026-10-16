"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, Plus } from "lucide-react";
import Link from "next/link";
import { formatLagosDate } from "@fabtyna/shared";
import { ResponsiveTable } from "@/components/responsive-table";
import type { ResponsiveTableColumn } from "@/components/responsive-table";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { loansApi } from "@/lib/api";
import type { LoanListItemDto } from "@/lib/api/loans.api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

function statusTone(status: LoanListItemDto["status"]) {
  if (status === "OVERDUE") return "danger" as const;
  if (status === "PAID") return "success" as const;
  return "info" as const;
}

export default function LoansPage() {
  const loans = useQuery({
    queryKey: queryKeys.loans.list,
    queryFn: () => loansApi.list(),
  });

  const rows = useMemo(() => {
    return (loans.data ?? []).slice().sort((a, b) => {
      if (a.dueDate === null && b.dueDate === null) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [loans.data]);

  const totals = useMemo(() => {
    let borrowed = 0n;
    let toRepay = 0n;
    let repaid = 0n;
    let outstanding = 0n;
    for (const loan of rows) {
      borrowed += BigInt(loan.principalKobo);
      toRepay += BigInt(loan.totalRepayableKobo);
      repaid += BigInt(loan.repaidKobo);
      outstanding += BigInt(loan.outstandingKobo);
    }
    return { borrowed, toRepay, repaid, outstanding };
  }, [rows]);

  const columns: ResponsiveTableColumn<LoanListItemDto>[] = [
    {
      header: "Lender",
      render: (loan) => (
        <Link
          href={`/accounting/loans/${loan.id}`}
          className="font-medium text-primary hover:underline"
        >
          {loan.lenderName}
        </Link>
      ),
    },
    {
      header: "Borrowed",
      align: "right",
      render: (loan) => <Money kobo={loan.principalKobo} tone="neutral" />,
    },
    {
      header: "Total to repay",
      align: "right",
      render: (loan) => <Money kobo={loan.totalRepayableKobo} tone="neutral" />,
    },
    {
      header: "Repaid",
      align: "right",
      render: (loan) => <Money kobo={loan.repaidKobo} tone="neutral" />,
    },
    {
      header: "Outstanding",
      align: "right",
      render: (loan) =>
        BigInt(loan.outstandingKobo) > 0n ? (
          <Money kobo={loan.outstandingKobo} />
        ) : (
          <span className="text-success">
            <Money kobo={0n} tone="neutral" />
          </span>
        ),
    },
    {
      header: "Due date",
      render: (loan) =>
        loan.dueDate === null ? (
          <span className="text-muted-foreground">No due date</span>
        ) : (
          formatLagosDate(loan.dueDate)
        ),
    },
    {
      header: "Status",
      render: (loan) => (
        <Badge tone={statusTone(loan.status)}>
          {loan.status === "PAID"
            ? "Paid"
            : loan.status === "OVERDUE"
              ? "Overdue"
              : "Active"}
        </Badge>
      ),
    },
    {
      header: "",
      align: "right",
      render: (loan) => (
        <Link
          href={`/accounting/loans/${loan.id}`}
          className="text-sm text-primary hover:underline"
        >
          View
        </Link>
      ),
    },
  ];

  const hasAny = (loans.data?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans"
        description="Money you have borrowed and what is still owed."
        actions={
          <Link href="/accounting/loans/new" className={buttonClasses({})}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New loan
          </Link>
        }
      />

      {hasAny && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Borrowed"
            value={<Money kobo={totals.borrowed} tone="neutral" />}
            icon={Landmark}
          />
          <StatCard
            label="Total to repay"
            value={<Money kobo={totals.toRepay} tone="neutral" />}
          />
          <StatCard
            label="Repaid"
            value={<Money kobo={totals.repaid} tone="neutral" />}
            tone="success"
          />
          <StatCard
            label="Outstanding"
            value={<Money kobo={totals.outstanding} />}
            tone={totals.outstanding > 0n ? "danger" : "default"}
          />
        </div>
      )}

      <Card className="p-4 sm:p-5">
        {loans.isPending ? (
          <Skeleton variant="row" count={5} />
        ) : loans.isError ? (
          <ErrorState
            title="Loans could not be loaded"
            message={toUserMessage(loans.error)}
            onRetry={() => void loans.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No loans recorded"
            description="Record money you have borrowed to include it in your financial position."
            action={
              <Link
                href="/accounting/loans/new"
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                New loan
              </Link>
            }
          />
        ) : (
          <ResponsiveTable
            rows={rows}
            columns={columns}
            getKey={(loan) => loan.id}
          />
        )}
      </Card>
    </div>
  );
}
