import type {
  CustomerLedgerEntryType,
  SupplierLedgerEntryType,
} from "./types";

export type AccountLedgerType =
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

type SignRule = "positive" | "negative" | "either";

const customerLedgerSigns: Record<CustomerLedgerEntryType, SignRule> = {
  SALE: "positive",
  PAYMENT: "negative",
  RETURN: "negative",
  CUSTOMER_REFUND: "negative",
  ADJUSTMENT: "either",
};

const supplierLedgerSigns: Record<SupplierLedgerEntryType, SignRule> = {
  PURCHASE: "positive",
  PAYMENT: "negative",
  ADJUSTMENT: "either",
};

const accountLedgerSigns: Record<AccountLedgerType, SignRule> = {
  SALE_PAYMENT: "positive",
  CUSTOMER_PAYMENT: "positive",
  SUPPLIER_PAYMENT: "negative",
  EXPENSE: "negative",
  CUSTOMER_REFUND: "negative",
  TRANSFER_IN: "positive",
  TRANSFER_OUT: "negative",
  OWNER_CAPITAL: "positive",
  OWNER_DRAWING: "negative",
  OTHER_INCOME: "positive",
  BANK_OR_POS_CHARGE: "negative",
  ADJUSTMENT: "either",
};

function assertSignedAmount(
  type: string,
  amountKobo: bigint,
  expected: SignRule,
): void {
  if (amountKobo === 0n) {
    throw new RangeError(`${type} ledger amounts must not be zero.`);
  }
  if (expected === "positive" && amountKobo < 0n) {
    throw new RangeError(`${type} ledger amounts must be positive.`);
  }
  if (expected === "negative" && amountKobo > 0n) {
    throw new RangeError(`${type} ledger amounts must be negative.`);
  }
}

export function validateCustomerLedgerAmount(
  type: CustomerLedgerEntryType,
  amountKobo: bigint,
): void {
  assertSignedAmount(type, amountKobo, customerLedgerSigns[type]);
}

export function validateSupplierLedgerAmount(
  type: SupplierLedgerEntryType,
  amountKobo: bigint,
): void {
  assertSignedAmount(type, amountKobo, supplierLedgerSigns[type]);
}

export function validateAccountLedgerAmount(
  type: AccountLedgerType,
  amountKobo: bigint,
): void {
  assertSignedAmount(type, amountKobo, accountLedgerSigns[type]);
}

export function calculateLedgerBalance(amountsKobo: readonly bigint[]): bigint {
  return amountsKobo.reduce((balance, amount) => balance + amount, 0n);
}

export function validateCompletedSalePayment(
  totalKobo: bigint,
  paidKobo: bigint,
  customerId: string | null,
): void {
  if (totalKobo < 0n || paidKobo < 0n) {
    throw new RangeError("Sale total and payments must not be negative.");
  }
  if (paidKobo > totalKobo) {
    throw new RangeError("Payments may not exceed the sale total.");
  }
  if (paidKobo < totalKobo && !customerId) {
    throw new RangeError("A customer is required when a sale is not fully paid.");
  }
}
