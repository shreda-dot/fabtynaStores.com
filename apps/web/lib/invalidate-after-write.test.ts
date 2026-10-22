import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "./create-query-client";
import { invalidateReportsAndBalances } from "./invalidate-after-write";
import { queryKeys } from "./query-keys";

function seededClient(client = createAppQueryClient()) {
  const reportKeys = [
    queryKeys.reports.dashboard("2026-01-01"),
    queryKeys.reports.salesSummary("2026-01-01", "2026-01-02"),
    queryKeys.reports.moneyFlow("2026-01-01", "2026-01-02", null),
    queryKeys.reports.productSales("2026-01-01", "2026-01-02", null, 20),
    queryKeys.reports.financialPosition({
      scenario: null,
      stockDiscountBps: 0,
      receivablesCollectibleBps: 10000,
      includeReceivables: true,
      includeCash: true,
    }),
    queryKeys.accounting.accountBalances,
  ];
  for (const key of reportKeys) client.setQueryData(key, { ok: true });
  client.setQueryData(queryKeys.products.list("", false), { ok: true });
  return { client, reportKeys };
}

const isStale = (client: ReturnType<typeof createAppQueryClient>, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated === true;

describe("invalidateReportsAndBalances", () => {
  it("marks every report and account-balance query stale, and leaves unrelated queries alone", async () => {
    const { client, reportKeys } = seededClient();
    for (const key of reportKeys) expect(isStale(client, key)).toBe(false);

    await invalidateReportsAndBalances(client);

    // Expected: all 6 seeded report/balance keys are invalidated; the products list is not.
    for (const key of reportKeys) expect(isStale(client, key)).toBe(true);
    expect(isStale(client, queryKeys.products.list("", false))).toBe(false);
  });
});

describe("createAppQueryClient mutation safety net", () => {
  it("marks report keys stale after a successful write, not after a failed one", async () => {
    const { client, reportKeys } = seededClient();

    await client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          throw new Error("rejected");
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    // A failed write changes nothing, so nothing is marked stale.
    for (const key of reportKeys) expect(isStale(client, key)).toBe(false);

    await client
      .getMutationCache()
      .build(client, { mutationFn: async () => "saved" })
      .execute(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const key of reportKeys) expect(isStale(client, key)).toBe(true);
  });

  it("keeps the short default staleTime for plain queries (reports set their own 60 s)", () => {
    expect(createAppQueryClient().getDefaultOptions().queries?.staleTime).toBe(15_000);
  });
});
