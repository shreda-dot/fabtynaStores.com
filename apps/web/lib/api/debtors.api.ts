export type DebtorSaleDto = {
  id: string;
  reference: string | null;
  soldAt: string;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo: string;
  lines: Array<{ productName: string; quantity: string; unit: string }>;
  daysOutstanding: number;
};

export type DebtorDto = {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  balanceKobo: string;
  oldestUnpaidDate: string | null;
  sales: DebtorSaleDto[];
};

export type DebtorsListOptions = {
  search?: string;
  minBalanceKobo?: string;
  cursor?: string;
  limit?: number;
};

export type DebtorsPage = {
  items: DebtorDto[];
  grandTotalKobo: string;
  nextCursor: string | null;
};

export interface DebtorsApi {
  list(options?: DebtorsListOptions): Promise<DebtorsPage>;
  recordPayment(
    saleId: string,
    amountKobo: string,
    paidAt: string,
    accountId: string,
    idempotencyKey?: string,
  ): Promise<unknown>;
}
