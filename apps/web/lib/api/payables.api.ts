import type { PurchasePaymentStatus } from "@fabtyna/shared";

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
  itemsSummary: string;
  lineCount: number;
};

export type SupplierPayableDto = {
  supplierId: string;
  supplierName: string;
  balanceKobo: string;
  overdueKobo: string;
  purchases: PayableLineDto[];
};

export interface PayablesApi {
  /** Suppliers with an outstanding balance, largest owed first. */
  listOutstanding(): Promise<SupplierPayableDto[]>;
  /** A single supplier's outstanding breakdown, or null when nothing is owed. */
  getSupplierBreakdown(supplierId: string): Promise<SupplierPayableDto | null>;
}
