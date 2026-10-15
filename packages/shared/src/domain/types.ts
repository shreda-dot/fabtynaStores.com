export type ProductCategory = "BEER" | "SOFT_DRINK" | "OTHER";

export type SaleChannel = "RETAIL" | "WHOLESALE" | "BOTH";

export type Unit = "UNIT" | "PACK";

export type StockLocation = "WAREHOUSE" | "RETAIL_SHELF" | "MARKET";

export type StockMovementType =
  | "PURCHASE"
  | "SALE"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "RETURN";

export type TransferDirection = "IN" | "OUT";

export type PurchaseStatus = "DRAFT" | "RECEIVED" | "VOIDED";

export type SaleStatus = "DRAFT" | "COMPLETED" | "VOIDED";

export type CustomerType = "WHOLESALE" | "RETAIL";

export type ExpenseCategory =
  | "RENT"
  | "UTILITY"
  | "SALARY"
  | "TRANSPORT"
  | "MAINTENANCE"
  | "SUPPLIES"
  | "MARKETING"
  | "OTHER";

export type SupplierLedgerEntryType = "PURCHASE" | "PAYMENT" | "ADJUSTMENT";

export type CustomerLedgerEntryType =
  | "SALE"
  | "PAYMENT"
  | "RETURN"
  | "CUSTOMER_REFUND"
  | "ADJUSTMENT";

export type AccountEntryType =
  | "SALE_PAYMENT"
  | "CUSTOMER_PAYMENT"
  | "SUPPLIER_PAYMENT"
  | "EXPENSE"
  | "CUSTOMER_REFUND"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "OWNER_CAPITAL"
  | "OWNER_DRAWING"
  | "OTHER_INCOME"
  | "BANK_OR_POS_CHARGE"
  | "ADJUSTMENT";

export type StockAdjustmentStatus = "COMPLETED" | "VOIDED";

export interface AdminUserPublic {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: ProductCategory;
  packName: string;
  unitsPerPack: number;
  saleChannel: SaleChannel;
  retailPriceKobo: bigint;
  wholesalePriceKobo: bigint;
  averageCostKobo: bigint;
  reorderLevelUnits: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
  creditLimitKobo: bigint;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Purchase {
  id: string;
  supplierId: string | null;
  createdById: string;
  status: PurchaseStatus;
  reference: string | null;
  notes: string | null;
  totalKobo: bigint;
  purchasedAt: Date;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  productId: string;
  unit: Unit;
  quantity: number;
  unitsPerPackSnapshot: number;
  quantityUnits: number;
  unitCostKobo: bigint;
  lineTotalKobo: bigint;
}

export interface Sale {
  id: string;
  customerId: string | null;
  customerName: string | null;
  createdById: string;
  channel: SaleChannel;
  status: SaleStatus;
  reference: string | null;
  notes: string | null;
  totalKobo: bigint;
  paidKobo: bigint;
  soldAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaleLine {
  id: string;
  saleId: string;
  productId: string;
  unit: Unit;
  quantity: number;
  unitsPerPackSnapshot: number;
  quantityUnits: number;
  unitPriceKobo: bigint;
  lineTotalKobo: bigint;
}

export interface StockTransfer {
  id: string;
  createdById: string;
  from: StockLocation;
  to: StockLocation;
  reason: string | null;
  reference: string | null;
  transferredAt: Date;
  createdAt: Date;
}

export interface StockTransferLine {
  id: string;
  transferId: string;
  productId: string;
  quantityUnits: number;
}

export interface SalePayment {
  id: string;
  saleId: string;
  amountKobo: bigint;
  paidAt: Date;
  createdAt: Date;
}

export interface StockTransferLeg {
  id: string;
  transferLineId: string;
  location: StockLocation;
  direction: TransferDirection;
}

export interface StockAdjustment {
  id: string;
  createdById: string;
  reason: string;
  status: StockAdjustmentStatus;
  adjustedAt: Date;
  createdAt: Date;
}

export interface StockAdjustmentLine {
  id: string;
  adjustmentId: string;
  productId: string;
  location: StockLocation;
  quantityDeltaUnits: number;
  unitCostKobo: bigint;
  reason: string | null;
}

export interface StockMovement {
  id: string;
  productId: string;
  location: StockLocation;
  type: StockMovementType;
  quantityUnits: number;
  unitCostKobo: bigint;
  purchaseLineId: string | null;
  saleLineId: string | null;
  transferLegId: string | null;
  adjustmentLineId: string | null;
  returnLineId: string | null;
  reversesEntryId: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface SupplierLedgerEntry {
  id: string;
  supplierId: string;
  type: SupplierLedgerEntryType;
  amountKobo: bigint;
  purchaseId: string | null;
  supplierPaymentId: string | null;
  reversesEntryId: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface CustomerLedgerEntry {
  id: string;
  customerId: string;
  type: CustomerLedgerEntryType;
  amountKobo: bigint;
  saleId: string | null;
  salePaymentId: string | null;
  customerPaymentId: string | null;
  saleReturnId: string | null;
  customerRefundId: string | null;
  reversesEntryId: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface Expense {
  id: string;
  channel: SaleChannel;
  category: ExpenseCategory;
  description: string;
  amountKobo: bigint;
  expenseDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountLedgerEntry {
  id: string;
  accountId: string;
  type: AccountEntryType;
  amountKobo: bigint;
  salePaymentId: string | null;
  customerPaymentId: string | null;
  supplierPaymentId: string | null;
  expenseId: string | null;
  otherIncomeId: string | null;
  accountTransferId: string | null;
  customerRefundId: string | null;
  reversesEntryId: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: unknown;
  afterData: unknown;
  occurredAt: Date;
  metadata: unknown;
}
