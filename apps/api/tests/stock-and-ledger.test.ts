import { describe, expect, it } from "vitest";
import {
  calculateLedgerBalance,
  validateAccountLedgerAmount,
  validateCompletedSalePayment,
  validateCustomerLedgerAmount,
  validateSupplierLedgerAmount,
} from "../src/lib/ledger";
import {
  assertStockWillRemainNonnegative,
  calculateStockUnits,
  calculateWeightedAverageCostKobo,
  splitStockIntoPacks,
} from "../src/modules/stock/stock.service";

describe("stock ledger math", () => {
  it("sums signed units and displays pack remainder", () => {
    expect(calculateStockUnits([48, -3, -8])).toBe(37);
    expect(splitStockIntoPacks(37, 24)).toEqual({ packs: 1, remainingUnits: 13 });
  });

  it("calculates weighted average cost using integer kobo", () => {
    expect(calculateWeightedAverageCostKobo(10n, 100n, 5n, 750n)).toBe(110n);
  });

  it("rejects a movement that would make stock negative", () => {
    expect(() => assertStockWillRemainNonnegative(4n, -5n)).toThrow(
      "Stock cannot be reduced below zero.",
    );
    expect(() => assertStockWillRemainNonnegative(4n, -4n)).not.toThrow();
  });
});

describe("signed financial ledger math", () => {
  it("enforces customer, supplier, and account ledger signs", () => {
    expect(() => validateCustomerLedgerAmount("SALE", 100n)).not.toThrow();
    expect(() => validateCustomerLedgerAmount("PAYMENT", -100n)).not.toThrow();
    expect(() => validateCustomerLedgerAmount("RETURN", 100n)).toThrow();
    expect(() => validateSupplierLedgerAmount("PAYMENT", -100n)).not.toThrow();
    expect(() => validateAccountLedgerAmount("EXPENSE", -100n)).not.toThrow();
    expect(() => validateAccountLedgerAmount("OTHER_INCOME", -100n)).toThrow();
  });

  it("calculates balances without floating-point arithmetic", () => {
    expect(calculateLedgerBalance([15_025n, -5_000n, -1n])).toBe(10_024n);
  });

  it("requires a customer for an unpaid sale and disallows overpayment", () => {
    expect(() => validateCompletedSalePayment(1_000n, 500n, null)).toThrow(
      "A customer is required when a sale is not fully paid.",
    );
    expect(() => validateCompletedSalePayment(1_000n, 1_001n, "customer-1")).toThrow(
      "Payments may not exceed the sale total.",
    );
    expect(() => validateCompletedSalePayment(1_000n, 1_000n, null)).not.toThrow();
  });
});
