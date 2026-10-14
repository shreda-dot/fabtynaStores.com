import { describe, expect, it } from "vitest";
import type {
  AccountLedgerEntry,
  CustomerLedgerEntry,
  StockMovement,
  SupplierLedgerEntry,
} from "../domain/types.ts";
import { buildLedgerReversal } from "../domain/ledger.ts";
import { buildStockMovementReversal } from "../domain/stock.ts";

const originalAt = new Date("2026-10-13T10:00:00.000Z");
const reversedAt = new Date("2026-10-13T11:00:00.000Z");

const customerEntry: CustomerLedgerEntry = {
  id: "customer-entry-1",
  customerId: "customer-1",
  type: "CUSTOMER_REFUND",
  amountKobo: 2500n,
  saleId: null,
  salePaymentId: null,
  customerPaymentId: null,
  saleReturnId: null,
  customerRefundId: "refund-1",
  reversesEntryId: null,
  note: null,
  occurredAt: originalAt,
};

const supplierEntry: SupplierLedgerEntry = {
  id: "supplier-entry-1",
  supplierId: "supplier-1",
  type: "PAYMENT",
  amountKobo: -4000n,
  purchaseId: null,
  supplierPaymentId: "supplier-payment-1",
  reversesEntryId: null,
  note: null,
  occurredAt: originalAt,
};

const accountEntry: AccountLedgerEntry = {
  id: "account-entry-1",
  accountId: "account-1",
  type: "CUSTOMER_REFUND",
  amountKobo: -2500n,
  salePaymentId: null,
  customerPaymentId: null,
  supplierPaymentId: null,
  expenseId: null,
  otherIncomeId: null,
  accountTransferId: null,
  customerRefundId: "refund-1",
  reversesEntryId: null,
  note: null,
  occurredAt: originalAt,
};

describe("ledger reversals", () => {
  it("preserves customer, type, source ids and negates the amount", () => {
    const reversal = buildLedgerReversal(
      customerEntry,
      [customerEntry],
      "customer-entry-2",
      reversedAt,
    );

    expect(reversal).toMatchObject({
      id: "customer-entry-2",
      customerId: customerEntry.customerId,
      type: customerEntry.type,
      amountKobo: -2500n,
      customerRefundId: customerEntry.customerRefundId,
      reversesEntryId: customerEntry.id,
      occurredAt: reversedAt,
    });
  });

  it("preserves supplier owner and source ids while negating the amount", () => {
    const reversal = buildLedgerReversal(
      supplierEntry,
      [supplierEntry],
      "supplier-entry-2",
      reversedAt,
    );

    expect(reversal).toMatchObject({
      supplierId: supplierEntry.supplierId,
      type: supplierEntry.type,
      amountKobo: 4000n,
      supplierPaymentId: supplierEntry.supplierPaymentId,
      reversesEntryId: supplierEntry.id,
    });
  });

  it("preserves account owner and source ids while negating the amount", () => {
    const reversal = buildLedgerReversal(
      accountEntry,
      [accountEntry],
      "account-entry-2",
      reversedAt,
    );

    expect(reversal).toMatchObject({
      accountId: accountEntry.accountId,
      type: accountEntry.type,
      amountKobo: 2500n,
      customerRefundId: accountEntry.customerRefundId,
      reversesEntryId: accountEntry.id,
    });
  });

  it("does not allow a reversal of a reversal", () => {
    const reversal = buildLedgerReversal(
      customerEntry,
      [customerEntry],
      "customer-entry-2",
      reversedAt,
    );

    expect(() =>
      buildLedgerReversal(
        reversal,
        [customerEntry, reversal],
        "customer-entry-3",
        reversedAt,
      ),
    ).toThrow("A reversal entry cannot itself be reversed.");
  });

  it("does not reverse a ledger row that already has a reversal", () => {
    const alreadyReversed: CustomerLedgerEntry = {
      ...customerEntry,
      id: "customer-entry-2",
      amountKobo: -customerEntry.amountKobo,
      reversesEntryId: customerEntry.id,
    };

    expect(() =>
      buildLedgerReversal(
        customerEntry,
        [customerEntry, alreadyReversed],
        "customer-entry-3",
        reversedAt,
      ),
    ).toThrow("This ledger entry has already been reversed.");
  });

  it("requires a unique reversal id", () => {
    expect(() =>
      buildLedgerReversal(customerEntry, [], customerEntry.id, reversedAt),
    ).toThrow("Reversal id must be nonempty and unique.");
  });
});

describe("stock movement reversals", () => {
  const outTransferMovement: StockMovement = {
    id: "movement-out-1",
    productId: "product-1",
    location: "WAREHOUSE",
    type: "TRANSFER",
    quantityUnits: -12,
    unitCostKobo: 1750n,
    purchaseLineId: null,
    saleLineId: null,
    transferLegId: "transfer-leg-out-1",
    adjustmentLineId: null,
    returnLineId: null,
    reversesEntryId: null,
    occurredAt: originalAt,
    createdAt: originalAt,
  };

  it("reverses an OUT transfer leg with same source/type/cost and opposite quantity", () => {
    const reversal = buildStockMovementReversal(
      outTransferMovement,
      [outTransferMovement],
      "movement-out-2",
      reversedAt,
    );

    expect(reversal).toMatchObject({
      id: "movement-out-2",
      productId: outTransferMovement.productId,
      location: outTransferMovement.location,
      type: "TRANSFER",
      quantityUnits: 12,
      unitCostKobo: outTransferMovement.unitCostKobo,
      transferLegId: outTransferMovement.transferLegId,
      reversesEntryId: outTransferMovement.id,
      occurredAt: reversedAt,
      createdAt: reversedAt,
    });
  });

  it("does not allow a reversal of a stock reversal", () => {
    const reversal = buildStockMovementReversal(
      outTransferMovement,
      [outTransferMovement],
      "movement-out-2",
      reversedAt,
    );

    expect(() =>
      buildStockMovementReversal(
        reversal,
        [outTransferMovement, reversal],
        "movement-out-3",
        reversedAt,
      ),
    ).toThrow("A reversal movement cannot itself be reversed.");
  });

  it("does not reverse a stock movement that already has a reversal", () => {
    const existingReversal: StockMovement = {
      ...outTransferMovement,
      id: "movement-out-2",
      quantityUnits: 12,
      reversesEntryId: outTransferMovement.id,
    };

    expect(() =>
      buildStockMovementReversal(
        outTransferMovement,
        [outTransferMovement, existingReversal],
        "movement-out-3",
        reversedAt,
      ),
    ).toThrow("This stock movement has already been reversed.");
  });

  it("requires a unique reversal movement id", () => {
    expect(() =>
      buildStockMovementReversal(
        outTransferMovement,
        [],
        outTransferMovement.id,
        reversedAt,
      ),
    ).toThrow("Reversal id must be nonempty and unique.");
  });
});
