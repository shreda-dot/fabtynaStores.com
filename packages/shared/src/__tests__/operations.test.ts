import { describe, expect, it } from "vitest";
import type {
  Product,
  Expense,
  Sale,
  StockAdjustmentLine,
  StockMovement,
  SupplierLedgerEntry,
} from "../domain/types.ts";
import {
  buildAdjustment,
  buildTransfer,
  recordSale,
  receivePurchase,
  salesSummary,
  voidAdjustment,
  voidPurchase,
} from "../domain/operations.ts";
import {
  buildStockMovementReversal,
  recomputeAverageCostKobo,
} from "../domain/stock.ts";

const baseDate = new Date("2026-10-01T10:00:00.000Z");

let idCounter = 0;
const newId = () => `id-${++idCounter}`;

// Money always moves through a named account, so every paid flow below names
// one. Its value is irrelevant to these tests.
const TEST_ACCOUNT_ID = "acct-test";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: `p-${idCounter + 1}`,
    name: "Lager",
    sku: "LAG",
    category: "BEER",
    packName: "crate",
    unitsPerPack: 24,
    saleChannel: "BOTH",
    retailPriceKobo: 500n,
    wholesalePriceKobo: 10000n,
    averageCostKobo: 0n,
    reorderLevelUnits: 12,
    deletedAt: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

describe("receivePurchase", () => {
  it("averages two lines of the same product on top of each other", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 1, averageCostKobo: 0n });
    const result = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: "PUR-DUP",
        accountId: TEST_ACCOUNT_ID,
        lines: [
          { productId: "p1", unit: "UNIT", quantity: 10, lineTotalKobo: 10000n },
          { productId: "p1", unit: "UNIT", quantity: 5, lineTotalKobo: 10000n },
        ],
      },
      [product],
      [],
      newId,
    );

    expect(result.productUpdates).toHaveLength(1);
    // 20000 kobo over 15 units, rounded: the same as one combined line.
    expect(result.productUpdates[0].averageCostKobo).toBe(1333n);
  });

  it("converts a crate purchase to units", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 24, averageCostKobo: 0n });
    const result = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: "PUR-001",
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "PACK", quantity: 2, lineTotalKobo: 48000n }],
      },
      [product],
      [],
      newId,
    );

    expect(result.purchaseLines[0].quantityUnits).toBe(48);
    expect(result.movements[0].quantityUnits).toBe(48);
    expect(result.movements[0].type).toBe("PURCHASE");
    expect(result.movements[0].location).toBe("WAREHOUSE");
  });

  it("computes average cost across two purchases at different prices", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 12, averageCostKobo: 0n });

    const first = receivePurchase(
      {
        supplierId: null,
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "UNIT", quantity: 10, lineTotalKobo: 1000n }],
      },
      [product],
      [],
      newId,
    );
    expect(first.productUpdates[0].averageCostKobo).toBe(100n);

    const afterFirst: Product = {
      ...product,
      averageCostKobo: first.productUpdates[0].averageCostKobo,
    };
    const second = receivePurchase(
      {
        supplierId: null,
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "UNIT", quantity: 5, lineTotalKobo: 750n }],
      },
      [afterFirst],
      first.movements,
      newId,
    );
    // existing 10 @ 100 + 5 @ 150 => total 1750 / 15 = 116.67 -> 117
    expect(second.productUpdates[0].averageCostKobo).toBe(117n);
  });

  it("does not lose kobo when a crate price does not divide evenly into units", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 24, averageCostKobo: 0n });
    // 1 crate (24 units) for 100 kobo total. unitCostKobo rounds to 4 (100/24=4.17)
    // but the average must use the exact total 100, not 4*24=96.
    const result = receivePurchase(
      {
        supplierId: null,
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 100n }],
      },
      [product],
      [],
      newId,
    );

    expect(result.purchaseLines[0].unitCostKobo).toBe(4n);
    // average must reflect exact total: 100 / 24 = 4.17 -> 4
    expect(result.productUpdates[0].averageCostKobo).toBe(4n);
    // Now a second crate at 200 kobo: existing 24 units @ 4 avg + 24 units for 200
    // total cost = 24*4 + 200 = 296; total units = 48; avg = 296/48 = 6.17 -> 6
    const afterFirst: Product = {
      ...product,
      averageCostKobo: result.productUpdates[0].averageCostKobo,
    };
    const second = receivePurchase(
      {
        supplierId: null,
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 200n }],
      },
      [afterFirst],
      result.movements,
      newId,
    );
    expect(second.productUpdates[0].averageCostKobo).toBe(6n);
  });

  it("creates a supplier ledger PURCHASE entry only when a supplier is set", () => {
    const product = makeProduct({ id: "p1" });
    const withSupplier = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "UNIT", quantity: 1, lineTotalKobo: 100n }],
      },
      [product],
      [],
      newId,
    );
    expect(withSupplier.supplierLedgerEntry).not.toBeNull();
    expect(withSupplier.supplierLedgerEntry!.type).toBe("PURCHASE");
    expect(withSupplier.supplierLedgerEntry!.amountKobo).toBe(100n);

    const withoutSupplier = receivePurchase(
      {
        supplierId: null,
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [{ productId: "p1", unit: "UNIT", quantity: 1, lineTotalKobo: 100n }],
      },
      [product],
      [],
      newId,
    );
    expect(withoutSupplier.supplierLedgerEntry).toBeNull();
  });
});

describe("buildTransfer", () => {
  it("creates paired OUT and IN movements", () => {
    const product = makeProduct({ id: "p1", averageCostKobo: 150n });
    const existing: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 48,
        unitCostKobo: 150n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: baseDate,
        createdAt: baseDate,
      },
    ];

    const result = buildTransfer(
      {
        createdById: "admin",
        from: "WAREHOUSE",
        to: "RETAIL_SHELF",
        reason: null,
        reference: null,
        transferredAt: baseDate,
        lines: [{ productId: "p1", quantityUnits: 12 }],
      },
      [product],
      existing,
      newId,
    );

    expect(result.transferLegs).toHaveLength(2);
    expect(result.movements).toHaveLength(2);
    const out = result.movements.find((m) => m.location === "WAREHOUSE")!;
    const inn = result.movements.find((m) => m.location === "RETAIL_SHELF")!;
    expect(out.quantityUnits).toBe(-12);
    expect(inn.quantityUnits).toBe(12);
    expect(out.unitCostKobo).toBe(150n);
    expect(inn.unitCostKobo).toBe(150n);
  });

  it("rejects a transfer that would make source stock negative", () => {
    const product = makeProduct({ id: "p1", averageCostKobo: 150n });
    const existing: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 10,
        unitCostKobo: 150n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: baseDate,
        createdAt: baseDate,
      },
    ];

    expect(() =>
      buildTransfer(
        {
          createdById: "admin",
          from: "WAREHOUSE",
          to: "RETAIL_SHELF",
          reason: null,
          reference: null,
          transferredAt: baseDate,
          lines: [{ productId: "p1", quantityUnits: 12 }],
        },
        [product],
        existing,
        newId,
      ),
    ).toThrow("Stock cannot be reduced below zero");
  });

  it("rejects a transfer between the same location", () => {
    const product = makeProduct({ id: "p1" });
    expect(() =>
      buildTransfer(
        {
          createdById: "admin",
          from: "WAREHOUSE",
          to: "WAREHOUSE",
          reason: null,
          reference: null,
          transferredAt: baseDate,
          lines: [{ productId: "p1", quantityUnits: 5 }],
        },
        [product],
        [],
        newId,
      ),
    ).toThrow("two different locations");
  });
});

describe("buildAdjustment", () => {
  it("applies a positive adjustment with a user-entered cost and updates average", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 1, averageCostKobo: 100n });
    const existing: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 10,
        unitCostKobo: 100n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: baseDate,
        createdAt: baseDate,
      },
    ];

    const result = buildAdjustment(
      {
        createdById: "admin",
        reason: "Found extra stock",
        adjustedAt: baseDate,
        lines: [{ productId: "p1", location: "WAREHOUSE", quantityDeltaUnits: 5, unitCostKobo: 120n }],
      },
      [product],
      existing,
      newId,
    );

    expect(result.movements[0].quantityUnits).toBe(5);
    expect(result.movements[0].unitCostKobo).toBe(120n);
    // existing 10 @ 100 + 5 @ 120 => (1000 + 600) / 15 = 106.67 -> 107
    expect(result.productUpdates[0].averageCostKobo).toBe(107n);
  });

  it("uses current average for a positive adjustment when no cost is given", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 1, averageCostKobo: 100n });
    const existing: StockMovement[] = [];

    const result = buildAdjustment(
      {
        createdById: "admin",
        reason: "Opening stock",
        adjustedAt: baseDate,
        lines: [{ productId: "p1", location: "WAREHOUSE", quantityDeltaUnits: 10, unitCostKobo: null }],
      },
      [product],
      existing,
      newId,
    );

    expect(result.movements[0].unitCostKobo).toBe(100n);
  });

  it("applies a negative adjustment without changing average cost", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 1, averageCostKobo: 100n });
    const existing: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 10,
        unitCostKobo: 100n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: baseDate,
        createdAt: baseDate,
      },
    ];

    const result = buildAdjustment(
      {
        createdById: "admin",
        reason: "Damaged stock",
        adjustedAt: baseDate,
        lines: [{ productId: "p1", location: "WAREHOUSE", quantityDeltaUnits: -3, unitCostKobo: null }],
      },
      [product],
      existing,
      newId,
    );

    expect(result.movements[0].quantityUnits).toBe(-3);
    expect(result.productUpdates).toHaveLength(0);
  });

  it("rejects a negative adjustment that would make stock negative", () => {
    const product = makeProduct({ id: "p1", averageCostKobo: 100n });
    const existing: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 2,
        unitCostKobo: 100n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: baseDate,
        createdAt: baseDate,
      },
    ];

    expect(() =>
      buildAdjustment(
        {
          createdById: "admin",
          reason: "Write-off",
          adjustedAt: baseDate,
          lines: [{ productId: "p1", location: "WAREHOUSE", quantityDeltaUnits: -5, unitCostKobo: null }],
        },
        [product],
        existing,
        newId,
      ),
    ).toThrow("Stock cannot be reduced below zero");
  });
});

describe("voidPurchase", () => {
  function setupPurchaseWithStock() {
    const product = makeProduct({ id: "p1", unitsPerPack: 12, averageCostKobo: 100n });
    const purchaseId = "pur1";
    const purchaseLineId = "pl1";
    const purchase = {
      id: purchaseId,
      supplierId: "s1",
      createdById: "admin",
      status: "RECEIVED" as const,
      reference: null,
      notes: null,
      totalKobo: 1200n,
      paidKobo: 0n,
      dueDate: null,
      purchasedAt: baseDate,
      receivedAt: baseDate,
      createdAt: baseDate,
      updatedAt: baseDate,
    };
    const purchaseLine = {
      id: purchaseLineId,
      purchaseId,
      productId: "p1",
      unit: "PACK" as const,
      quantity: 1,
      unitsPerPackSnapshot: 12,
      quantityUnits: 12,
      unitCostKobo: 100n,
      lineTotalKobo: 1200n,
    };
    const purchaseMovement: StockMovement = {
      id: "m1",
      productId: "p1",
      location: "WAREHOUSE",
      type: "PURCHASE",
      quantityUnits: 12,
      unitCostKobo: 100n,
      purchaseLineId,
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: baseDate,
      createdAt: baseDate,
    };
    const ledger: SupplierLedgerEntry = {
      id: "le1",
      supplierId: "s1",
      type: "PURCHASE",
      amountKobo: 1200n,
      purchaseId,
      supplierPaymentId: null,
      reversesEntryId: null,
      note: null,
      occurredAt: baseDate,
    };
    return { product, purchase, purchaseLine, purchaseMovement, ledger };
  }

  it("blocks void when stock was already sold", () => {
    const { product, purchase, purchaseLine, purchaseMovement, ledger } = setupPurchaseWithStock();
    const sale: StockMovement = {
      id: "m2",
      productId: "p1",
      location: "WAREHOUSE",
      type: "SALE",
      quantityUnits: -5,
      unitCostKobo: 100n,
      purchaseLineId: null,
      saleLineId: "sl1",
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: baseDate,
      createdAt: baseDate,
    };

    // Stock: 12 - 5 = 7. Reversing purchase (-12) => 7 - 12 = -5. Blocked.
    expect(() =>
      voidPurchase(
        purchase.id,
        baseDate,
        [purchase],
        [purchaseLine],
        [purchaseMovement, sale],
        [ledger],
        newId,
      ),
    ).toThrow("would make stock");
  });

  it("allows void when all purchased stock is still present", () => {
    const { product, purchase, purchaseLine, purchaseMovement, ledger } = setupPurchaseWithStock();

    const result = voidPurchase(
      purchase.id,
      baseDate,
      [purchase],
      [purchaseLine],
      [purchaseMovement],
      [ledger],
      newId,
    );

    expect(result.reversalMovements).toHaveLength(1);
    expect(result.reversalMovements[0].quantityUnits).toBe(-12);
    expect(result.reversalSupplierLedgerEntry).not.toBeNull();
    expect(result.reversalSupplierLedgerEntry!.amountKobo).toBe(-1200n);
    // Average cost after void: no movements left => 0
    expect(result.productUpdates[0].averageCostKobo).toBe(0n);
  });

  it("restores the previous average cost after a void", () => {
    const product = makeProduct({ id: "p1", unitsPerPack: 1, averageCostKobo: 50n });
    // Existing stock before the purchase being voided: 10 units @ 50
    const existingMovement: StockMovement = {
      id: "m0",
      productId: "p1",
      location: "WAREHOUSE",
      type: "PURCHASE",
      quantityUnits: 10,
      unitCostKobo: 50n,
      purchaseLineId: "pl0",
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: baseDate,
      createdAt: baseDate,
    };
    const purchaseId = "pur1";
    const purchaseLineId = "pl1";
    const purchase = {
      id: purchaseId,
      supplierId: null,
      createdById: "admin",
      status: "RECEIVED" as const,
      reference: null,
      notes: null,
      totalKobo: 1000n,
      paidKobo: 0n,
      dueDate: null,
      purchasedAt: baseDate,
      receivedAt: baseDate,
      createdAt: baseDate,
      updatedAt: baseDate,
    };
    const purchaseLine = {
      id: purchaseLineId,
      purchaseId,
      productId: "p1",
      unit: "UNIT" as const,
      quantity: 10,
      unitsPerPackSnapshot: 1,
      quantityUnits: 10,
      unitCostKobo: 100n,
      lineTotalKobo: 1000n,
    };
    const purchaseMovement: StockMovement = {
      id: "m1",
      productId: "p1",
      location: "WAREHOUSE",
      type: "PURCHASE",
      quantityUnits: 10,
      unitCostKobo: 100n,
      purchaseLineId,
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: baseDate,
      createdAt: baseDate,
    };

    const result = voidPurchase(
      purchaseId,
      baseDate,
      [purchase],
      [purchaseLine],
      [existingMovement, purchaseMovement],
      [],
      newId,
    );

    // After void, only m0 remains: 10 units @ 50 => average 50
    expect(result.productUpdates[0].averageCostKobo).toBe(50n);
  });
});

describe("salesSummary", () => {
  it("excludes voided expenses from reported costs", () => {
    const expense: Expense = {
      id: "expense-voided",
      channel: "RETAIL",
      category: "RENT",
      description: "Voided rent entry",
      amountKobo: 5000n,
      expenseDate: baseDate,
      loanRepaymentId: null,
      voidedAt: baseDate,
      voidReason: "Duplicate",
      createdAt: baseDate,
      updatedAt: baseDate,
    };

    const result = salesSummary(
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-10-02T00:00:00.000Z"),
      [],
      [],
      [],
      [expense],
      [],
      new Set(),
    );

    expect(result.totals.totalExpensesKobo).toBe(0n);
  });

  it("uses wholesale pack pricing for standard revenue instead of unit-multiplying the pack price", () => {
    const product = makeProduct({
      id: "p1",
      saleChannel: "WHOLESALE",
      unitsPerPack: 24,
      wholesalePriceKobo: 10000n,
      averageCostKobo: 500n,
    });

    const received = receivePurchase(
      {
        supplierId: null,
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [
          {
            productId: "p1",
            unit: "PACK",
            quantity: 2,
            lineTotalKobo: 12000n,
          },
        ],
      },
      [product],
      [],
      newId,
    );

    const stockedProduct: Product = {
      ...product,
      averageCostKobo: received.productUpdates[0].averageCostKobo,
    };

    const recorded = recordSale(
      {
        customerId: "c1",
        customerName: "Wholesale buyer",
        createdById: "admin",
        channel: "WHOLESALE",
        location: "WAREHOUSE",
        soldAt: baseDate,
        notes: null,
        reference: null,
        paidKobo: 0n,
        lines: [
          {
            productId: "p1",
            unit: "PACK",
            quantity: 2,
            unitPriceKobo: 10000n,
          },
        ],
      },
      [stockedProduct],
      received.movements,
      newId,
    );

    const result = salesSummary(
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-10-02T00:00:00.000Z"),
      [recorded.sale],
      recorded.saleLines,
      [stockedProduct],
      [],
      [],
      new Set(),
    );

    expect(result.totals.totalSupposedRevenueKobo).toBe(20000n);
    expect(result.totals.totalStandardRevenueKobo).toBe(20000n);
  });

  it("excludes reversed payments and payments before the requested period", () => {
    const sale: Sale = {
      id: "sale-report",
      customerId: null,
      customerName: "Walk-in",
      createdById: "admin",
      channel: "RETAIL",
      status: "COMPLETED",
      reference: "S-REPORT",
      notes: null,
      totalKobo: 5000n,
      paidKobo: 5000n,
      soldAt: new Date("2026-10-02T12:00:00.000Z"),
      createdAt: baseDate,
      updatedAt: baseDate,
    };
    const result = salesSummary(
      new Date("2026-10-02T00:00:00.000Z"),
      new Date("2026-10-03T00:00:00.000Z"),
      [sale],
      [],
      [],
      [],
      [
        {
          id: "reversed-payment",
          saleId: sale.id,
          accountId: TEST_ACCOUNT_ID,
          amountKobo: 3000n,
          paidAt: new Date("2026-10-02T13:00:00.000Z"),
          createdAt: baseDate,
        },
        {
          id: "payment-before-range",
          saleId: sale.id,
          accountId: TEST_ACCOUNT_ID,
          amountKobo: 2000n,
          paidAt: new Date("2026-10-01T13:00:00.000Z"),
          createdAt: baseDate,
        },
      ],
      new Set(["reversed-payment"]),
    );

    // No cash was received in this period: the in-range payment was reversed,
    // and the other payment belongs to the preceding period.
    expect(result.totals.totalRevenueGottenKobo).toBe(0n);
  });

  it("does not infer receipt timing from a sale's current paid balance", () => {
    const sale: Sale = {
      id: "sale-report-no-payment-history",
      customerId: "customer-1",
      customerName: "Customer",
      createdById: "admin",
      channel: "RETAIL",
      status: "COMPLETED",
      reference: "S-REPORT-NO-PAYMENT-HISTORY",
      notes: null,
      totalKobo: 5000n,
      paidKobo: 3000n,
      soldAt: new Date("2026-10-02T12:00:00.000Z"),
      createdAt: baseDate,
      updatedAt: baseDate,
    };

    const result = salesSummary(
      new Date("2026-10-02T00:00:00.000Z"),
      new Date("2026-10-03T00:00:00.000Z"),
      [sale],
      [],
      [],
      [],
      [],
      new Set(),
    );

    expect(result.totals.totalRevenueGottenKobo).toBe(0n);
  });
});

describe("recordSale", () => {
  function stockedProductAndMovements() {
    const product = makeProduct({
      id: "p1",
      unitsPerPack: 24,
      averageCostKobo: 0n,
    });
    const received = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        accountId: TEST_ACCOUNT_ID,
        lines: [
          { productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 24000n },
        ],
      },
      [product],
      [],
      newId,
    );
    return {
      product: {
        ...product,
        averageCostKobo: received.productUpdates[0].averageCostKobo,
      },
      movements: received.movements,
    };
  }

  it("rejects an unpaid sale with no customer", () => {
    const { product, movements } = stockedProductAndMovements();

    expect(() =>
      recordSale(
        {
          customerId: null,
          customerName: "Walk-in buyer",
          createdById: "admin",
          channel: "RETAIL",
          location: "WAREHOUSE",
          soldAt: baseDate,
          notes: null,
          reference: null,
          paidKobo: 0n,
          lines: [
            { productId: "p1", unit: "UNIT", quantity: 2, unitPriceKobo: 500n },
          ],
        },
        [product],
        movements,
        newId,
      ),
    ).toThrow("A customer is required when a sale is not fully paid.");
  });

  it("records an unpaid sale when a customer is set and writes the ledger entry", () => {
    const { product, movements } = stockedProductAndMovements();

    const recorded = recordSale(
      {
        customerId: "c1",
        customerName: null,
        createdById: "admin",
        channel: "RETAIL",
        location: "WAREHOUSE",
        soldAt: baseDate,
        notes: null,
        reference: null,
        paidKobo: 200n,
        accountId: TEST_ACCOUNT_ID,
        lines: [
          { productId: "p1", unit: "UNIT", quantity: 2, unitPriceKobo: 500n },
        ],
      },
      [product],
      movements,
      newId,
    );

    expect(recorded.sale.status).toBe("COMPLETED");
    expect(recorded.sale.totalKobo).toBe(1000n);
    expect(recorded.customerLedgerEntry?.amountKobo).toBe(800n);
    expect(recorded.customerLedgerEntry?.customerId).toBe("c1");
  });

  it("records a fully paid sale without a customer and writes no ledger entry", () => {
    const { product, movements } = stockedProductAndMovements();

    const recorded = recordSale(
      {
        customerId: null,
        customerName: null,
        createdById: "admin",
        channel: "RETAIL",
        location: "WAREHOUSE",
        soldAt: baseDate,
        notes: null,
        reference: null,
        paidKobo: 1000n,
        accountId: TEST_ACCOUNT_ID,
        lines: [
          { productId: "p1", unit: "UNIT", quantity: 2, unitPriceKobo: 500n },
        ],
      },
      [product],
      movements,
      newId,
    );

    expect(recorded.sale.status).toBe("COMPLETED");
    expect(recorded.customerLedgerEntry).toBeNull();
    expect(recorded.salePayment?.amountKobo).toBe(1000n);
  });

  it("rejects two lines for one product whose combined quantity exceeds stock", () => {
    const { product, movements } = stockedProductAndMovements();

    // Stock is 24 units: each 15-unit line fits alone, together they do not.
    expect(() =>
      recordSale(
        {
          customerId: null,
          customerName: null,
          createdById: "admin",
          channel: "RETAIL",
          location: "WAREHOUSE",
          soldAt: baseDate,
          notes: null,
          reference: null,
          paidKobo: 15000n,
          accountId: TEST_ACCOUNT_ID,
          lines: [
            { productId: "p1", unit: "UNIT", quantity: 15, unitPriceKobo: 500n },
            { productId: "p1", unit: "UNIT", quantity: 15, unitPriceKobo: 500n },
          ],
        },
        [product],
        movements,
        newId,
      ),
    ).toThrow(RangeError);
  });
});

describe("voidAdjustment", () => {
  it("voids an adjustment and reverses its movements", () => {
    const product = makeProduct({ id: "p1", averageCostKobo: 100n });
    const adjustmentId = "adj1";
    const adjustmentLineId = "al1";
    const adjustment = {
      id: adjustmentId,
      createdById: "admin",
      reason: "Correction",
      status: "COMPLETED" as const,
      adjustedAt: baseDate,
      createdAt: baseDate,
    };
    const adjustmentLine: StockAdjustmentLine = {
      id: adjustmentLineId,
      adjustmentId,
      productId: "p1",
      location: "WAREHOUSE",
      quantityDeltaUnits: 5,
      unitCostKobo: 100n,
      reason: null,
    };
    const adjMovement: StockMovement = {
      id: "m1",
      productId: "p1",
      location: "WAREHOUSE",
      type: "ADJUSTMENT",
      quantityUnits: 5,
      unitCostKobo: 100n,
      purchaseLineId: null,
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: baseDate,
      createdAt: baseDate,
    };

    const result = voidAdjustment(
      adjustmentId,
      baseDate,
      [adjustment],
      [adjustmentLine],
      [adjMovement],
      newId,
    );

    expect(result.reversalMovements).toHaveLength(1);
    expect(result.reversalMovements[0].quantityUnits).toBe(-5);
    expect(result.reversalSupplierLedgerEntry).toBeNull();
  });
});

describe("reversing an OUT transfer leg", () => {
  it("is allowed via buildStockMovementReversal", () => {
    const outMovement: StockMovement = {
      id: "m-out",
      productId: "p1",
      location: "WAREHOUSE",
      type: "TRANSFER",
      quantityUnits: -12,
      unitCostKobo: 150n,
      purchaseLineId: null,
      saleLineId: null,
      transferLegId: "leg-out",
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: baseDate,
      createdAt: baseDate,
    };

    const reversal = buildStockMovementReversal(
      outMovement,
      [outMovement],
      "m-out-rev",
      baseDate,
    );

    expect(reversal.quantityUnits).toBe(12);
    expect(reversal.type).toBe("TRANSFER");
    expect(reversal.transferLegId).toBe("leg-out");
    expect(reversal.reversesEntryId).toBe("m-out");
  });
});

describe("recomputeAverageCostKobo", () => {
  it("skips reversed movements and replays receipts", () => {
    const movements: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 10,
        unitCostKobo: 100n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: new Date("2026-10-01T10:00:00.000Z"),
        createdAt: baseDate,
      },
      {
        id: "m1-rev",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: -10,
        unitCostKobo: 100n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: "m1",
        occurredAt: new Date("2026-10-02T10:00:00.000Z"),
        createdAt: baseDate,
      },
      {
        id: "m2",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 5,
        unitCostKobo: 200n,
        purchaseLineId: "pl2",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: new Date("2026-10-03T10:00:00.000Z"),
        createdAt: baseDate,
      },
    ];

    // m1 is reversed, so only m2 counts: 5 units @ 200 => 200
    expect(recomputeAverageCostKobo(movements)).toBe(200n);
  });

  it("leaves average unchanged when stock is reduced by a sale", () => {
    const movements: StockMovement[] = [
      {
        id: "m1",
        productId: "p1",
        location: "WAREHOUSE",
        type: "PURCHASE",
        quantityUnits: 10,
        unitCostKobo: 100n,
        purchaseLineId: "pl1",
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: new Date("2026-10-01T10:00:00.000Z"),
        createdAt: baseDate,
      },
      {
        id: "m2",
        productId: "p1",
        location: "WAREHOUSE",
        type: "SALE",
        quantityUnits: -4,
        unitCostKobo: 100n,
        purchaseLineId: null,
        saleLineId: "sl1",
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: new Date("2026-10-02T10:00:00.000Z"),
        createdAt: baseDate,
      },
    ];

    expect(recomputeAverageCostKobo(movements)).toBe(100n);
  });
});
