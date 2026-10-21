import type {
  CreateSaleDto,
  CustomerDto,
  SaleDto,
  SaleLineDto,
  SalePaymentDto,
  StockMovementDto,
} from "@fabtyna/shared";

export type SaleListItemDto = SaleDto & {
  customerName: string | null;
  lineCount: number;
  /** Real API only: what is still owed (0 for a voided sale). */
  balanceDueKobo?: string;
};

export type SaleLineWithProductDto = SaleLineDto & {
  productName: string;
  location?: string;
};

export type SalePaymentDetailDto = SalePaymentDto & {
  accountName?: string;
  /** Real API only: true once a reversal entry exists for this payment. */
  reversed?: boolean;
};

/** What the sale detail needs about its customer (the API does not send the rest). */
export type SaleCustomerSummaryDto = Pick<CustomerDto, "id" | "name" | "type" | "phone"> & {
  isActive?: boolean;
};

export type SaleDetailDto = SaleDto & {
  customer: SaleCustomerSummaryDto | null;
  lines: SaleLineWithProductDto[];
  movements: StockMovementDto[];
  payments: SalePaymentDetailDto[];
  /** Real API only; derive from totalKobo - paidKobo when absent. */
  balanceDueKobo?: string;
  livePaymentsKobo?: string;
};

/** Amend returns the NEW sale plus the id of the sale it voided. */
export type SaleAmendResultDto = SaleDetailDto & { voidedSaleId?: string };

export type SaleListOptions = {
  from?: string;
  to?: string;
  status?: "COMPLETED" | "VOIDED";
  channel?: "RETAIL" | "WHOLESALE";
  customerId?: string;
  unpaid?: boolean;
  search?: string;
  limit?: number;
  cursor?: string | null;
};

export type SaleListPage = {
  items: SaleListItemDto[];
  nextCursor: string | null;
  /** The date range the server applied (null when a search suppressed it). */
  from: string | null;
  to: string | null;
};

export interface SalesApi {
  list(): Promise<SaleListItemDto[]>;
  listPage(options: SaleListOptions): Promise<SaleListPage>;
  getById(id: string): Promise<SaleDetailDto>;
  create(input: CreateSaleDto, idempotencyKey?: string): Promise<SaleDetailDto>;
  update(
    id: string,
    input: CreateSaleDto,
    idempotencyKey?: string,
  ): Promise<SaleAmendResultDto>;
  void(id: string, idempotencyKey?: string): Promise<SaleDetailDto>;
  recordPayment(
    id: string,
    amountKobo: string,
    paidAt: string,
    accountId: string,
    idempotencyKey?: string,
  ): Promise<SaleDetailDto>;
  reversePayment(
    id: string,
    paymentId: string,
    reason: string,
    idempotencyKey?: string,
  ): Promise<SaleDetailDto>;
}

/** What is still owed on a sale, from the API figure or the stored totals. */
export function saleBalanceDueKobo(sale: {
  status: string;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo?: string;
}): bigint {
  if (sale.balanceDueKobo !== undefined) return BigInt(sale.balanceDueKobo);
  if (sale.status === "VOIDED") return 0n;
  const due = BigInt(sale.totalKobo) - BigInt(sale.paidKobo);
  return due > 0n ? due : 0n;
}
