import type { PaymentMethod, PurchasePaymentStatus } from "@fabtyna/shared";

export type PayableLineDto = {
  purchaseId: string;
  reference: string | null;
  purchasedAt: string;
  dueDate: string | null;
  totalKobo: string;
  paidKobo: string;
  balanceKobo: string;
  status: PurchasePaymentStatus;
  overdue: boolean;
  itemsSummary?: string;
  lineCount?: number;
};

export type SupplierPayableDto = {
  supplierId: string;
  supplierName: string;
  balanceKobo: string;
  overdueKobo: string;
  purchases: PayableLineDto[];
};

export type PayablesListOptions = {
  search?: string;
  overdueOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type PayablesPage = {
  items: SupplierPayableDto[];
  grandTotalKobo: string;
  overdueTotalKobo: string;
  nextCursor: string | null;
};

export interface PayablesApi {
  /** Suppliers with an outstanding balance, largest owed first. */
  listOutstanding(options?: PayablesListOptions): Promise<SupplierPayableDto[] | PayablesPage>;
  /** A single supplier's outstanding breakdown, or null when nothing is owed. */
  getSupplierBreakdown(supplierId: string): Promise<SupplierPayableDto | null>;
  recordPayment(
    purchaseId: string,
    amountKobo: string,
    paidAt: string,
    method: PaymentMethod,
    accountId: string,
    note?: string,
    idempotencyKey?: string,
  ): Promise<void>;
}
