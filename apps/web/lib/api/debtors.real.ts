import { requestJson } from "./client";
import type {
  DebtorsApi,
  DebtorsListOptions,
  DebtorsPage,
} from "./debtors.api";

function queryString(options: DebtorsListOptions): string {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("q", options.search.trim());
  if (options.minBalanceKobo) query.set("minBalanceKobo", options.minBalanceKobo);
  if (options.cursor) query.set("cursor", options.cursor);
  query.set("limit", String(options.limit ?? 50));
  return `?${query.toString()}`;
}

export const debtorsRealApi: DebtorsApi = {
  async list(options = {}) {
    return requestJson<DebtorsPage>(`/debtors${queryString(options)}`);
  },
  async recordPayment(saleId, amountKobo, paidAt, accountId, idempotencyKey) {
    await requestJson<unknown>(
      `/sales/${encodeURIComponent(saleId)}/payments`,
      {
        method: "POST",
        body: { amountKobo, accountId, paidAt },
        idempotencyKey,
      },
    );
  },
};
