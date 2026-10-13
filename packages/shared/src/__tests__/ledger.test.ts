import { describe, expect, it } from "vitest";
import {
  calculateLedgerBalance,
  validateAccountLedgerAmount,
  validateCompletedSalePayment,
  validateCustomerLedgerAmount,
  validateSupplierLedgerAmount,
} from "../domain/ledger.js";

describe("signed financial ledger math", () => {
  it("enforces customer, supplier, and account ledger signs", () => {
    expect(() => validateCustomerLedgerAmount("SALE", 100n)).not.toThrow();
    expect(() => validateCustomerLedgerAmount("PAYMENT", -100n)).not.toThrow();
    expect(() => validateCustomerLedgerAmount("RETURN", 100n)).toThrow();
    expect(() => validateSupplierLedgerAmount("PAYMENT", -100n)).not.toThrow();
    expect(() => validateAccountLedgerAmount("EXPENSE", -100n)).not.toThrow();
    expect(() => validateAccountLedgerAmount("OTHER_INCOME", -100n)).toThrow();
  });

  it("rejects zero ledger amounts", () => {
    expect(() => validateCustomerLedgerAmount("SALE", 0n)).toThrow();
    expect(() => validateSupplierLedgerAmount("PURCHASE", 0n)).toThrow();
    expect(() => validateAccountLedgerAmount("EXPENSE", 0n)).toThrow();
  });

  it("calculates balances without floating-point arithmetic", () => {
    expect(calculateLedgerBalance([15_025n, -5_000n, -1n])).toBe(10_024n);
    expect(calculateLedgerBalance([])).toBe(0n);
  });

  it("requires a customer for an unpaid sale and disallows overpayment", () => {
    expect(() => validateCompletedSalePayment(1_000n, 500n, null)).toThrow(
      "A customer is required when a sale is not fully paid.",
    );
    expect(() => validateCompletedSalePayment(1_000n, 1_001n, "customer-1")).toThrow(
      "Payments may not exceed the sale total.",
    );
    expect(() => validateCompletedSalePayment(1_000n, 1_000n, null)).not.toThrow();
    expect(() => validateCompletedSalePayment(1_000n, 1_000n, "customer-1")).not.toThrow();
  });
});
