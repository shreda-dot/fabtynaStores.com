import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

/**
 * Marks every report and account-balance query stale after a successful write,
 * so the dashboard, sales summary, money flow, product sales, financial position
 * and account balances never show data older than the last write. The global
 * staleTime still applies to plain tab switching.
 */
export function invalidateReportsAndBalances(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.cash.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  ]).then(() => undefined);
}
