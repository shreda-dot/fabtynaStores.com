import { MutationCache, QueryClient } from "@tanstack/react-query";
import { invalidateReportsAndBalances } from "./invalidate-after-write";

/**
 * The app's QueryClient. Any successful mutation marks all report and
 * account-balance queries stale (safety net for every useMutation write path;
 * direct-call write flows call invalidateReportsAndBalances themselves).
 */
export function createAppQueryClient(): QueryClient {
  const mutationCache = new MutationCache();
  const client = new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 15_000,
        refetchOnWindowFocus: false,
      },
    },
  });
  mutationCache.subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success") {
      void invalidateReportsAndBalances(client);
    }
  });
  return client;
}
