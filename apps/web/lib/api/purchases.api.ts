import type {
  CreatePurchaseDto,
  PurchaseDto,
  PurchaseLineDto,
  StockMovementDto,
  SupplierDto,
  SupplierPaymentDto,
} from "@fabtyna/shared";
import type { PurchaseEmptiesPreviewDto, PurchaseEmptiesPreviewInput } from "./empties.api";

export type PurchaseListItemDto = PurchaseDto & {
  supplierName: string | null;
  lineCount: number;
  /** Real API only: what is still owed (0 for a voided purchase). */
  balanceDueKobo?: string;
};

export type PurchaseLineWithProductDto = PurchaseLineDto & {
  productName: string;
};

export type SupplierPaymentDetailDto = SupplierPaymentDto & {
  accountName?: string;
  /** Real API only: true once a reversal entry exists for this payment. */
  reversed?: boolean;
};

export type PurchaseMoneyEntriesDto = {
  supplierLedger: Array<{
    id: string;
    type: string;
    amountKobo: string;
    reversesEntryId: string | null;
    occurredAt: string;
  }>;
  account: Array<{
    id: string;
    accountId: string;
    accountName: string;
    type: string;
    amountKobo: string;
    reversesEntryId: string | null;
    occurredAt: string;
  }>;
};

export type PurchaseEmptiesDetailDto = {
  tracked: boolean;
  requirements: Array<{
    purchaseLineId: string;
    typeId: string;
    kind: "CRATE" | "BOTTLE";
    quantity: number;
    manualCrateCount: boolean;
    countPerUnitSnapshot: number | null;
    countPerPackSnapshot: number | null;
    label: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    typeId: string;
    kind: "CRATE" | "BOTTLE";
    label: string;
    obligationId: string | null;
    quantity: number;
    note: string | null;
    reversesEntryId: string | null;
    reversed: boolean;
    occurredAt: string;
  }>;
  debts: Array<{
    id: string;
    supplierId: string;
    typeId: string;
    kind: "CRATE" | "BOTTLE";
    label: string;
    quantity: number;
  }>;
};

export type PurchaseSupplierSummaryDto = Pick<SupplierDto, "id" | "name" | "phone"> & {
  isActive?: boolean;
};

export type PurchaseDetailDto = PurchaseDto & {
  supplier: PurchaseSupplierSummaryDto | null;
  lines: PurchaseLineWithProductDto[];
  movements: StockMovementDto[];
  payments: SupplierPaymentDetailDto[];
  balanceDueKobo?: string;
  livePaymentsKobo?: string;
  moneyEntries?: PurchaseMoneyEntriesDto;
  empties?: PurchaseEmptiesDetailDto;
};

export type PurchaseAmendResultDto = PurchaseDetailDto & {
  voidedPurchaseId?: string;
};

export type PurchaseListOptions = {
  from?: string;
  to?: string;
  supplierId?: string;
  status?: "RECEIVED" | "VOIDED";
  unpaid?: boolean;
  overdue?: boolean;
  search?: string;
  limit?: number;
  cursor?: string | null;
};

export type PurchaseListPage = {
  items: PurchaseListItemDto[];
  nextCursor: string | null;
  from: string | null;
  to: string | null;
};

export interface PurchasesApi {
  list(): Promise<PurchaseListItemDto[]>;
  listPage(options: PurchaseListOptions): Promise<PurchaseListPage>;
  getById(id: string): Promise<PurchaseDetailDto>;
  previewEmpties(input: PurchaseEmptiesPreviewInput): Promise<PurchaseEmptiesPreviewDto>;
  create(input: CreatePurchaseDto, idempotencyKey?: string): Promise<PurchaseDetailDto>;
  update(
    id: string,
    input: CreatePurchaseDto,
    idempotencyKey?: string,
  ): Promise<PurchaseAmendResultDto>;
  void(id: string, idempotencyKey?: string): Promise<PurchaseDetailDto>;
  recordPayment(
    id: string,
    amountKobo: string,
    paidAt: string,
    method: SupplierPaymentDto["method"],
    accountId: string,
    note?: string,
    idempotencyKey?: string,
  ): Promise<PurchaseDetailDto>;
  reversePayment(
    id: string,
    paymentId: string,
    reason: string,
    idempotencyKey?: string,
  ): Promise<PurchaseDetailDto>;
}

export function purchaseBalanceDueKobo(purchase: {
  status: string;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo?: string;
}): bigint {
  if (purchase.balanceDueKobo !== undefined) return BigInt(purchase.balanceDueKobo);
  if (purchase.status === "VOIDED") return 0n;
  const due = BigInt(purchase.totalKobo) - BigInt(purchase.paidKobo);
  return due > 0n ? due : 0n;
}
