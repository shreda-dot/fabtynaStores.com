import { describe, expect, it } from "vitest";
import type {
  Product,
  StockAdjustmentLine,
  StockMovement,
  StockTransferLeg,
  SupplierLedgerEntry,
} from "../domain/types.ts";
import {
  assertStoreInvariants,
  validateAtMostOneNonReversalMovementPerSource,
  validateMovementReversals,
  validateMovementSignAndSource,
  validateProductFields,
  validatePurchaseLineUnitConsistency,
  validateStockNeverNegative,
  validateSupplierLedgerEntry,
  validateSupplierLedgerReversals,
  validateTransferLegDirection,
} from "../domain/invariants.ts";

const baseMovement = (overrides: Partial<StockMovement> = {}): StockMovement => ({
  id: "m1",
  productId: "p1",
  location: "WAREHOUSE",
  type: "PURCHASE",
  quantityUnits: 24,
  unitCostKobo: 100n,
  purchaseLineId: "pl1",
  saleLineId: null,
  transferLegId: null,
  adjustmentLineId: null,
  returnLineId: null,
  reversesEntryId: null,
  occurredAt: new Date("2026-10-01T10:00:00.000Z"),
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
  ...overrides,
});

describe("movement quantity sign by type", () => {
  it("accepts a positive PURCHASE movement", () => {
    expect(() =>
      validateMovementSignAndSource(baseMovement({ type: "PURCHASE", quantityUnits: 24 })),
    ).not.toThrow();
  });

  it("rejects a negative PURCHASE movement", () => {
    expect(() =>
      validateMovementSignAndSource(baseMovement({ type: "PURCHASE", quantityUnits: -5 })),
    ).toThrow("PURCHASE stock movement must increase stock");
  });

  it("accepts a negative SALE movement", () => {
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({ type: "SALE", quantityUnits: -3, purchaseLineId: null, saleLineId: "sl1" }),
      ),
    ).not.toThrow();
  });

  it("rejects a positive SALE movement", () => {
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({ type: "SALE", quantityUnits: 3, purchaseLineId: null, saleLineId: "sl1" }),
      ),
    ).toThrow("SALE stock movement must decrease stock");
  });

  it("accepts a positive RETURN movement", () => {
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({ type: "RETURN", quantityUnits: 2, purchaseLineId: null, returnLineId: "rl1" }),
      ),
    ).not.toThrow();
  });

  it("rejects a zero ADJUSTMENT movement", () => {
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({
          type: "ADJUSTMENT",
          quantityUnits: 0,
          purchaseLineId: null,
          adjustmentLineId: "al1",
        }),
      ),
    ).toThrow("nonzero");
  });

  it("accepts nonzero ADJUSTMENT movements of either sign", () => {
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({
          type: "ADJUSTMENT",
          quantityUnits: 5,
          purchaseLineId: null,
          adjustmentLineId: "al1",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({
          type: "ADJUSTMENT",
          quantityUnits: -5,
          purchaseLineId: null,
          adjustmentLineId: "al2",
        }),
      ),
    ).not.toThrow();
  });
});

describe("exactly one source FK matching the type", () => {
  it("rejects a PURCHASE movement with no purchaseLineId", () => {
    expect(() =>
      validateMovementSignAndSource(baseMovement({ purchaseLineId: null })),
    ).toThrow("must reference its purchaseLineId");
  });

  it("rejects a PURCHASE movement that also references a sale line", () => {
    expect(() =>
      validateMovementSignAndSource(baseMovement({ saleLineId: "sl1" })),
    ).toThrow("must not reference saleLineId");
  });

  it("accepts a TRANSFER movement with only transferLegId", () => {
    expect(() =>
      validateMovementSignAndSource(
        baseMovement({
          type: "TRANSFER",
          quantityUnits: -5,
          purchaseLineId: null,
          transferLegId: "tl1",
        }),
      ),
    ).not.toThrow();
  });
});

describe("at most one non-reversal movement per source id", () => {
  it("accepts distinct source ids", () => {
    const m1 = baseMovement({ id: "m1", purchaseLineId: "pl1" });
    const m2 = baseMovement({ id: "m2", purchaseLineId: "pl2" });
    expect(() =>
      validateAtMostOneNonReversalMovementPerSource([m1, m2]),
    ).not.toThrow();
  });

  it("rejects two non-reversal movements for the same source", () => {
    const m1 = baseMovement({ id: "m1", purchaseLineId: "pl1" });
    const m2 = baseMovement({ id: "m2", purchaseLineId: "pl1" });
    expect(() =>
      validateAtMostOneNonReversalMovementPerSource([m1, m2]),
    ).toThrow("Only one non-reversal stock movement is allowed per source row");
  });

  it("allows a reversal to share its target's source id", () => {
    const original = baseMovement({ id: "m1", purchaseLineId: "pl1" });
    const reversal = baseMovement({
      id: "m2",
      purchaseLineId: "pl1",
      quantityUnits: -24,
      reversesEntryId: "m1",
    });
    expect(() =>
      validateAtMostOneNonReversalMovementPerSource([original, reversal]),
    ).not.toThrow();
  });
});

describe("movement reversal rules", () => {
  const original = baseMovement({
    id: "m1",
    productId: "p1",
    location: "WAREHOUSE",
    type: "PURCHASE",
    quantityUnits: 24,
    unitCostKobo: 100n,
    purchaseLineId: "pl1",
  });

  it("accepts a valid reversal", () => {
    const reversal = baseMovement({
      id: "m2",
      productId: "p1",
      location: "WAREHOUSE",
      type: "PURCHASE",
      quantityUnits: -24,
      unitCostKobo: 100n,
      purchaseLineId: "pl1",
      reversesEntryId: "m1",
    });
    expect(() => validateMovementReversals([original, reversal])).not.toThrow();
  });

  it("rejects a reversal with a different product", () => {
    const reversal = baseMovement({
      id: "m2",
      productId: "p2",
      quantityUnits: -24,
      reversesEntryId: "m1",
    });
    expect(() => validateMovementReversals([original, reversal])).toThrow(
      "same product",
    );
  });

  it("rejects a reversal with a different unit cost", () => {
    const reversal = baseMovement({
      id: "m2",
      quantityUnits: -24,
      unitCostKobo: 200n,
      reversesEntryId: "m1",
    });
    expect(() => validateMovementReversals([original, reversal])).toThrow(
      "same unit cost",
    );
  });

  it("rejects a reversal that does not exactly negate the quantity", () => {
    const reversal = baseMovement({
      id: "m2",
      quantityUnits: -20,
      reversesEntryId: "m1",
    });
    expect(() => validateMovementReversals([original, reversal])).toThrow(
      "negate the target quantity exactly",
    );
  });

  it("rejects a reversal of a reversal", () => {
    const reversal = baseMovement({
      id: "m2",
      quantityUnits: -24,
      reversesEntryId: "m1",
    });
    const reversalOfReversal = baseMovement({
      id: "m3",
      quantityUnits: 24,
      reversesEntryId: "m2",
    });
    expect(() =>
      validateMovementReversals([original, reversal, reversalOfReversal]),
    ).toThrow("cannot target another reversal");
  });

  it("rejects reversing the same target twice", () => {
    const r1 = baseMovement({ id: "m2", quantityUnits: -24, reversesEntryId: "m1" });
    const r2 = baseMovement({ id: "m3", quantityUnits: -24, reversesEntryId: "m1" });
    expect(() => validateMovementReversals([original, r1, r2])).toThrow(
      "already been reversed",
    );
  });
});

describe("transfer leg direction sign", () => {
  const legs: StockTransferLeg[] = [
    { id: "leg-out", transferLineId: "tl1", location: "WAREHOUSE", direction: "OUT" },
    { id: "leg-in", transferLineId: "tl1", location: "RETAIL_SHELF", direction: "IN" },
  ];

  it("accepts OUT negative and IN positive", () => {
    const movements: StockMovement[] = [
      baseMovement({
        id: "m1",
        type: "TRANSFER",
        quantityUnits: -12,
        purchaseLineId: null,
        transferLegId: "leg-out",
      }),
      baseMovement({
        id: "m2",
        type: "TRANSFER",
        quantityUnits: 12,
        purchaseLineId: null,
        transferLegId: "leg-in",
      }),
    ];
    expect(() => validateTransferLegDirection(movements, legs)).not.toThrow();
  });

  it("rejects an OUT leg with positive quantity", () => {
    const movements = [
      baseMovement({
        id: "m1",
        type: "TRANSFER",
        quantityUnits: 12,
        purchaseLineId: null,
        transferLegId: "leg-out",
      }),
    ];
    expect(() => validateTransferLegDirection(movements, legs)).toThrow(
      "OUT transfer leg movement must decrease stock",
    );
  });
});

describe("stock never below zero", () => {
  it("accepts nonnegative balances", () => {
    const movements = [
      baseMovement({ id: "m1", quantityUnits: 24 }),
      baseMovement({ id: "m2", quantityUnits: -10 }),
    ];
    expect(() => validateStockNeverNegative(movements)).not.toThrow();
  });

  it("rejects a negative balance at a location", () => {
    const movements = [
      baseMovement({ id: "m1", quantityUnits: 5 }),
      baseMovement({ id: "m2", quantityUnits: -10 }),
    ];
    expect(() => validateStockNeverNegative(movements)).toThrow("cannot be negative");
  });
});

describe("supplier ledger sign and source rules", () => {
  const baseEntry = (overrides: Partial<SupplierLedgerEntry> = {}): SupplierLedgerEntry => ({
    id: "e1",
    supplierId: "s1",
    type: "PURCHASE",
    amountKobo: 1000n,
    purchaseId: "pur1",
    supplierPaymentId: null,
    reversesEntryId: null,
    note: null,
    occurredAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  });

  it("accepts a positive PURCHASE with purchaseId", () => {
    expect(() => validateSupplierLedgerEntry(baseEntry())).not.toThrow();
  });

  it("rejects a negative PURCHASE amount", () => {
    expect(() => validateSupplierLedgerEntry(baseEntry({ amountKobo: -1000n }))).toThrow(
      "must be positive",
    );
  });

  it("accepts a negative PAYMENT with supplierPaymentId", () => {
    expect(() =>
      validateSupplierLedgerEntry(
        baseEntry({ type: "PAYMENT", amountKobo: -500n, purchaseId: null, supplierPaymentId: "sp1" }),
      ),
    ).not.toThrow();
  });

  it("rejects a PAYMENT without supplierPaymentId", () => {
    expect(() =>
      validateSupplierLedgerEntry(
        baseEntry({ type: "PAYMENT", amountKobo: -500n, purchaseId: null, supplierPaymentId: null }),
      ),
    ).toThrow("must reference a supplier payment only");
  });
});

describe("supplier ledger reversal rules", () => {
  const original: SupplierLedgerEntry = {
    id: "e1",
    supplierId: "s1",
    type: "PURCHASE",
    amountKobo: 1000n,
    purchaseId: "pur1",
    supplierPaymentId: null,
    reversesEntryId: null,
    note: null,
    occurredAt: new Date("2026-10-01T10:00:00.000Z"),
  };

  it("accepts a valid reversal", () => {
    const reversal: SupplierLedgerEntry = {
      ...original,
      id: "e2",
      amountKobo: -1000n,
      reversesEntryId: "e1",
    };
    expect(() => validateSupplierLedgerReversals([original, reversal])).not.toThrow();
  });

  it("rejects a reversal with a different supplier", () => {
    const reversal = { ...original, id: "e2", supplierId: "s2", amountKobo: -1000n, reversesEntryId: "e1" };
    expect(() => validateSupplierLedgerReversals([original, reversal])).toThrow(
      "same supplier",
    );
  });

  it("rejects double reversal", () => {
    const r1 = { ...original, id: "e2", amountKobo: -1000n, reversesEntryId: "e1" };
    const r2 = { ...original, id: "e3", amountKobo: -1000n, reversesEntryId: "e1" };
    expect(() => validateSupplierLedgerReversals([original, r1, r2])).toThrow(
      "already been reversed",
    );
  });
});

describe("product fields", () => {
  it("accepts valid product fields", () => {
    const products: Product[] = [
      {
        id: "p1",
        name: "Lager",
        sku: "LAG",
        category: "BEER",
        packName: "crate",
        saleChannel: "BOTH",
        unitsPerPack: 24,
        retailPriceKobo: 500n,
        wholesalePriceKobo: 10000n,
        averageCostKobo: 400n,
        reorderLevelUnits: 12,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    expect(() => validateProductFields(products)).not.toThrow();
  });

  it("rejects zero unitsPerPack", () => {
    const products: Product[] = [
      {
        id: "p1",
        name: "Lager",
        sku: null,
        category: "BEER",
        packName: "crate",
        saleChannel: "BOTH",
        unitsPerPack: 0,
        retailPriceKobo: 0n,
        wholesalePriceKobo: 0n,
        averageCostKobo: 0n,
        reorderLevelUnits: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    expect(() => validateProductFields(products)).toThrow("positive unitsPerPack");
  });

  it("rejects negative retail price", () => {
    const products: Product[] = [
      {
        id: "p1",
        name: "Lager",
        sku: null,
        category: "BEER",
        packName: "crate",
        saleChannel: "BOTH",
        unitsPerPack: 24,
        retailPriceKobo: -1n,
        wholesalePriceKobo: 0n,
        averageCostKobo: 0n,
        reorderLevelUnits: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    expect(() => validateProductFields(products)).toThrow("retail price must not be negative");
  });
});

describe("purchase line unit consistency", () => {
  it("accepts UNIT line with quantityUnits === quantity", () => {
    expect(() =>
      validatePurchaseLineUnitConsistency({
        unit: "UNIT",
        quantity: 5,
        unitsPerPackSnapshot: 24,
        quantityUnits: 5,
      }),
    ).not.toThrow();
  });

  it("rejects UNIT line with mismatched quantityUnits", () => {
    expect(() =>
      validatePurchaseLineUnitConsistency({
        unit: "UNIT",
        quantity: 5,
        unitsPerPackSnapshot: 24,
        quantityUnits: 6,
      }),
    ).toThrow("quantityUnits must equal quantity");
  });

  it("accepts PACK line with quantityUnits === quantity * unitsPerPack", () => {
    expect(() =>
      validatePurchaseLineUnitConsistency({
        unit: "PACK",
        quantity: 2,
        unitsPerPackSnapshot: 24,
        quantityUnits: 48,
      }),
    ).not.toThrow();
  });

  it("rejects PACK line with wrong quantityUnits", () => {
    expect(() =>
      validatePurchaseLineUnitConsistency({
        unit: "PACK",
        quantity: 2,
        unitsPerPackSnapshot: 24,
        quantityUnits: 47,
      }),
    ).toThrow("quantity * unitsPerPackSnapshot");
  });
});

describe("assertStoreInvariants composes all checks", () => {
  it("accepts a consistent store state", () => {
    const product: Product = {
      id: "p1",
      name: "Lager",
      sku: "LAG",
      category: "BEER",
      packName: "crate",
      saleChannel: "BOTH",
      unitsPerPack: 24,
      retailPriceKobo: 500n,
      wholesalePriceKobo: 10000n,
      averageCostKobo: 400n,
      reorderLevelUnits: 12,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const movement = baseMovement({ productId: "p1", quantityUnits: 24 });
    const adjustmentLine: StockAdjustmentLine = {
      id: "al1",
      adjustmentId: "a1",
      productId: "p1",
      location: "WAREHOUSE",
      quantityDeltaUnits: 5,
      unitCostKobo: 400n,
      reason: null,
    };

    expect(() =>
      assertStoreInvariants({
        products: [product],
        stockMovements: [movement],
        stockTransferLegs: [],
        supplierLedgerEntries: [],
        purchaseLines: [],
        stockAdjustmentLines: [adjustmentLine],
      }),
    ).not.toThrow();
  });
});
