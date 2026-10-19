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
  | "LOAN_INTEREST"
  | "OTHER";

/** How money physically left/entered the business. */
export type PaymentMethod = "CASH" | "TRANSFER" | "OTHER";

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
  | "PURCHASE_PAYMENT"
  | "EXPENSE"
  | "CUSTOMER_REFUND"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "OWNER_CAPITAL"
  | "OWNER_DRAWING"
  | "OTHER_INCOME"
  | "BANK_OR_POS_CHARGE"
  | "ADJUSTMENT"
  | "OPENING_BALANCE"
  | "LOAN_DISBURSEMENT"
  | "LOAN_REPAYMENT";

/**
 * What kind of place the money physically sits in. Used instead of a payment
 * "method" on the account ledger: cash lives in a CASH account, a transfer in
 * a BANK account and a POS settlement in a POS account.
 */
export type AccountType = "CASH" | "BANK" | "POS";

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
  /**
   * Authoritative amount already paid to the supplier for this purchase.
   * Denormalised from `SupplierPayment` rows so lists stay cheap to render.
   */
  paidKobo: bigint;
  /** Lagos business date (YYYY-MM-DD) the balance becomes overdue. Null = no due date. */
  dueDate: string | null;
  purchasedAt: Date;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Supplier-credit status for a purchase. Derived, never stored: the ledger and
 * `paidKobo` are the source of truth.
 */
export type PurchasePaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

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
  /** The account the money landed in. Never null for a new payment. */
  accountId: string;
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
  /**
   * Set when this expense was generated by a loan repayment's interest
   * portion. Enables the linked expense to be reversed alongside the
   * repayment instead of being edited.
   */
  loanRepaymentId: string | null;
  /**
   * Set when the expense was voided instead of edited. Voiding reverses the
   * money that left an account and keeps the expense out of reports; it is
   * never hard-deleted.
   */
  voidedAt: Date | null;
  /** Required (non-empty) whenever `voidedAt` is set. */
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A place money physically sits: a cash box, a bank account or a POS
 * settlement account. Accounts (not typed figures) are the source of truth
 * for how much money the business actually has.
 */
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  deactivatedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One movement of money between two accounts. Each transfer owns exactly two
 * `AccountLedgerEntry` rows (a TRANSFER_OUT and a TRANSFER_IN) that both point
 * back at it through `accountTransferId`.
 */
export interface AccountTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountKobo: bigint;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface AccountLedgerEntry {
  id: string;
  accountId: string;
  type: AccountEntryType;
  amountKobo: bigint;
  salePaymentId: string | null;
  customerPaymentId: string | null;
  supplierPaymentId: string | null;
  /** Set on PURCHASE_PAYMENT entries for a supplier-less cash purchase. */
  purchaseId: string | null;
  expenseId: string | null;
  otherIncomeId: string | null;
  accountTransferId: string | null;
  customerRefundId: string | null;
  /** Set on LOAN_DISBURSEMENT entries (money received from the lender). */
  loanId: string | null;
  /** Set on LOAN_REPAYMENT entries (money paid back). */
  loanRepaymentId: string | null;
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

/* ------------------------------------------------------------------ *
 * Accounting: supplier credit (payables), loans and cash snapshots.
 * ------------------------------------------------------------------ */

/**
 * Immutable record of one payment made to a supplier. Mirrors `SalePayment`.
 * The matching (negative) `SupplierLedgerEntry` references this row through
 * `supplierPaymentId`, keeping the ledger source-exclusivity invariant intact.
 */
export interface SupplierPayment {
  id: string;
  supplierId: string;
  purchaseId: string;
  /** The account the money left. Never null for a new payment. */
  accountId: string;
  amountKobo: bigint;
  method: PaymentMethod;
  note: string | null;
  paidAt: Date;
  createdAt: Date;
}

export type LoanLedgerEntryType = "DISBURSEMENT" | "CHARGE" | "REPAYMENT";

/** Derived, never stored. */
export type LoanStatus = "ACTIVE" | "PAID" | "OVERDUE";

export interface Loan {
  id: string;
  lenderName: string;
  principalKobo: bigint;
  /** Total interest/fee agreed up front. May be zero. */
  agreedInterestKobo: bigint;
  disbursedAt: Date;
  /** Lagos business date (YYYY-MM-DD). Null = no due date. */
  dueDate: string | null;
  note: string | null;
  createdAt: Date;
}

/**
 * Immutable loan ledger. Outstanding = DISBURSEMENT + CHARGE - REPAYMENT.
 * `loanRepaymentId` is set on REPAYMENT entries only (source exclusivity).
 */
export interface LoanLedgerEntry {
  id: string;
  loanId: string;
  type: LoanLedgerEntryType;
  amountKobo: bigint;
  loanRepaymentId: string | null;
  reversesEntryId: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface LoanRepayment {
  id: string;
  loanId: string;
  amountKobo: bigint;
  /** Portion of `amountKobo` that is interest. Drives the linked expense. */
  interestPortionKobo: bigint;
  note: string | null;
  paidAt: Date;
  createdAt: Date;
}

/**
 * Immutable manual cash/bank balance. The latest row by `asOfDate` then
 * `createdAt` is the balance used in financial-position calculations.
 */
export interface CashSnapshot {
  id: string;
  /** Lagos business date (YYYY-MM-DD). */
  asOfDate: string;
  amountKobo: bigint;
  note: string | null;
  createdAt: Date;
}
