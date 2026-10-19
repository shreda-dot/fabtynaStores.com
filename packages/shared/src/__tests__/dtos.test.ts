import { describe, expect, it } from "vitest";
import type {
  AuditLog,
  Product,
  Purchase,
  PurchaseLine,
  StockAdjustment,
  StockAdjustmentLine,
  StockMovement,
  StockTransfer,
  StockTransferLeg,
  StockTransferLine,
  Supplier,
  SupplierLedgerEntry,
} from "../domain/types.ts";
import {
  auditLogDtoSchema,
  customerDtoSchema,
  customerLedgerEntryDtoSchema,
  purchaseReceiveDtoSchema,
  accountLedgerEntryDtoSchema,
  adminUserPublicDtoSchema,
  productDtoSchema,
  purchaseDtoSchema,
  purchaseLineDtoSchema,
  stockAdjustmentDtoSchema,
  stockAdjustmentLineDtoSchema,
  stockMovementDtoSchema,
  stockTransferDtoSchema,
  stockTransferLegDtoSchema,
  stockTransferLineDtoSchema,
  supplierDtoSchema,
  supplierLedgerEntryDtoSchema,
} from "../schemas/index.ts";
import {
  fromAuditLogDto,
  fromProductDto,
  fromPurchaseDto,
  fromPurchaseLineDto,
  fromStockAdjustmentDto,
  fromStockAdjustmentLineDto,
  fromStockMovementDto,
  fromStockTransferDto,
  fromStockTransferLegDto,
  fromStockTransferLineDto,
  fromSupplierDto,
  fromSupplierLedgerEntryDto,
  toAuditLogDto,
  toProductDto,
  toPurchaseDto,
  toPurchaseLineDto,
  toStockAdjustmentDto,
  toStockAdjustmentLineDto,
  toStockMovementDto,
  toStockTransferDto,
  toStockTransferLegDto,
  toStockTransferLineDto,
  toSupplierDto,
  toSupplierLedgerEntryDto,
} from "../dto-conversions.ts";

const timestamp = new Date("2026-10-13T10:00:00.000Z");
const largeKobo = 9_007_199_254_740_993n;

const product: Product = {
  id: "product-1",
  name: "Lager",
  sku: "LAG-1",
  category: "BEER",
  packName: "crate",
  unitsPerPack: 24,
  saleChannel: "BOTH",
  retailPriceKobo: largeKobo,
  wholesalePriceKobo: largeKobo + 1n,
  averageCostKobo: largeKobo + 2n,
  reorderLevelUnits: 24,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const supplier: Supplier = {
  id: "supplier-1",
  name: "Lagos Beverage Distributors",
  phone: null,
  email: "orders@example.test",
  address: null,
  notes: "Main supplier",
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const supplierLedgerEntry: SupplierLedgerEntry = {
  id: "supplier-ledger-1",
  supplierId: supplier.id,
  type: "PAYMENT",
  amountKobo: -largeKobo,
  purchaseId: null,
  supplierPaymentId: "supplier-payment-1",
  reversesEntryId: null,
  note: null,
  occurredAt: timestamp,
};

const stockMovement: StockMovement = {
  id: "movement-1",
  productId: product.id,
  location: "WAREHOUSE",
  type: "PURCHASE",
  quantityUnits: 48,
  unitCostKobo: largeKobo,
  purchaseLineId: "purchase-line-1",
  saleLineId: null,
  transferLegId: null,
  adjustmentLineId: null,
  returnLineId: null,
  reversesEntryId: null,
  occurredAt: timestamp,
  createdAt: timestamp,
};

const purchase: Purchase = {
  id: "purchase-1",
  supplierId: supplier.id,
  createdById: "admin-1",
  status: "RECEIVED",
  reference: "PUR-2026-001",
  notes: null,
  totalKobo: largeKobo,
  paidKobo: largeKobo,
  dueDate: null,
  purchasedAt: timestamp,
  receivedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const purchaseLine: PurchaseLine = {
  id: "purchase-line-1",
  purchaseId: purchase.id,
  productId: product.id,
  unit: "PACK",
  quantity: 2,
  unitsPerPackSnapshot: 24,
  quantityUnits: 48,
  unitCostKobo: largeKobo,
  lineTotalKobo: largeKobo + 10n,
};

const stockTransfer: StockTransfer = {
  id: "transfer-1",
  createdById: "admin-1",
  from: "WAREHOUSE",
  to: "RETAIL_SHELF",
  reason: null,
  reference: "TRF-TEST01",
  transferredAt: timestamp,
  createdAt: timestamp,
};

const stockTransferLine: StockTransferLine = {
  id: "transfer-line-1",
  transferId: stockTransfer.id,
  productId: product.id,
  quantityUnits: 12,
};

const stockTransferLeg: StockTransferLeg = {
  id: "transfer-leg-1",
  transferLineId: stockTransferLine.id,
  location: "WAREHOUSE",
  direction: "OUT",
};

const stockAdjustment: StockAdjustment = {
  id: "adjustment-1",
  createdById: "admin-1",
  reason: "Stock count correction",
  status: "COMPLETED",
  adjustedAt: timestamp,
  createdAt: timestamp,
};

const stockAdjustmentLine: StockAdjustmentLine = {
  id: "adjustment-line-1",
  adjustmentId: stockAdjustment.id,
  productId: product.id,
  location: "WAREHOUSE",
  quantityDeltaUnits: -1,
  unitCostKobo: largeKobo,
  reason: null,
};

const auditLog: AuditLog = {
  id: "audit-1",
  actorId: "admin-1",
  action: "PRODUCT_UPDATED",
  entityType: "Product",
  entityId: product.id,
  beforeData: { retailPriceKobo: "100" },
  afterData: { retailPriceKobo: "200" },
  metadata: null,
  occurredAt: timestamp,
};

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe("entity DTO schemas", () => {
  it("validates every entity DTO after a JSON stringify/parse round-trip", () => {
    const samples = [
      [adminUserPublicDtoSchema, {
        id: "admin-1",
        email: "owner@example.test",
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
      }],
      [auditLogDtoSchema, toAuditLogDto(auditLog)],
      [customerDtoSchema, {
        id: "customer-1",
        name: "Corner Shop",
        type: "RETAIL",
        creditLimitKobo: "0",
        phone: null,
        email: null,
        address: null,
        notes: null,
        deletedAt: null,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
      }],
      [customerLedgerEntryDtoSchema, {
        id: "customer-ledger-1",
        customerId: "customer-1",
        type: "CUSTOMER_REFUND",
        amountKobo: largeKobo.toString(),
        saleId: null,
        salePaymentId: null,
        customerPaymentId: null,
        saleReturnId: null,
        customerRefundId: "refund-1",
        reversesEntryId: null,
        note: null,
        occurredAt: timestamp.toISOString(),
      }],
      [accountLedgerEntryDtoSchema, {
        id: "account-ledger-1",
        accountId: "cash-account",
        type: "CUSTOMER_REFUND",
        amountKobo: (-largeKobo).toString(),
        salePaymentId: null,
        customerPaymentId: null,
        supplierPaymentId: null,
        purchaseId: null,
        expenseId: null,
        otherIncomeId: null,
        accountTransferId: null,
        customerRefundId: "refund-1",
        loanId: null,
        loanRepaymentId: null,
        reversesEntryId: null,
        note: null,
        occurredAt: timestamp.toISOString(),
      }],
      [productDtoSchema, toProductDto(product)],
      [purchaseDtoSchema, toPurchaseDto(purchase)],
      [purchaseLineDtoSchema, toPurchaseLineDto(purchaseLine)],
      [stockAdjustmentDtoSchema, toStockAdjustmentDto(stockAdjustment)],
      [stockAdjustmentLineDtoSchema, toStockAdjustmentLineDto(stockAdjustmentLine)],
      [stockMovementDtoSchema, toStockMovementDto(stockMovement)],
      [stockTransferDtoSchema, toStockTransferDto(stockTransfer)],
      [stockTransferLineDtoSchema, toStockTransferLineDto(stockTransferLine)],
      [stockTransferLegDtoSchema, toStockTransferLegDto(stockTransferLeg)],
      [supplierDtoSchema, toSupplierDto(supplier)],
      [supplierLedgerEntryDtoSchema, toSupplierLedgerEntryDto(supplierLedgerEntry)],
    ] as const;

    for (const [schema, dto] of samples) {
      expect(schema.parse(jsonRoundTrip(dto))).toEqual(dto);
    }
  });

  it("rejects non-integer money strings", () => {
    expect(() =>
      productDtoSchema.parse({
        ...toProductDto(product),
        retailPriceKobo: "1.5",
      }),
    ).toThrow();
    expect(() =>
      supplierLedgerEntryDtoSchema.parse({
        ...toSupplierLedgerEntryDto(supplierLedgerEntry),
        amountKobo: "-1.5",
      }),
    ).toThrow();
  });

  it("requires purchase receive lineTotalKobo as an integer string", () => {
    const request = {
      lines: [
        {
          purchaseLineId: "purchase-line-1",
          quantityUnits: 24,
          lineTotalKobo: largeKobo.toString(),
        },
      ],
    };

    expect(
      purchaseReceiveDtoSchema.parse(jsonRoundTrip(request)).lines[0].lineTotalKobo,
    ).toBe(largeKobo.toString());
    expect(() =>
      purchaseReceiveDtoSchema.parse({
        lines: [{ ...request.lines[0], lineTotalKobo: 432000 }],
      }),
    ).toThrow();
  });
});

describe("domain and DTO conversion pairs", () => {
  const conversionChecks: { name: string; run: () => void }[] = [
    {
      name: "Product",
      run: () => expect(fromProductDto(toProductDto(product))).toEqual(product),
    },
    {
      name: "Supplier",
      run: () => expect(fromSupplierDto(toSupplierDto(supplier))).toEqual(supplier),
    },
    {
      name: "SupplierLedgerEntry",
      run: () =>
        expect(
          fromSupplierLedgerEntryDto(toSupplierLedgerEntryDto(supplierLedgerEntry)),
        ).toEqual(supplierLedgerEntry),
    },
    {
      name: "StockMovement",
      run: () =>
        expect(fromStockMovementDto(toStockMovementDto(stockMovement))).toEqual(
          stockMovement,
        ),
    },
    {
      name: "Purchase",
      run: () => expect(fromPurchaseDto(toPurchaseDto(purchase))).toEqual(purchase),
    },
    {
      name: "PurchaseLine",
      run: () =>
        expect(fromPurchaseLineDto(toPurchaseLineDto(purchaseLine))).toEqual(
          purchaseLine,
        ),
    },
    {
      name: "StockTransfer",
      run: () =>
        expect(fromStockTransferDto(toStockTransferDto(stockTransfer))).toEqual(
          stockTransfer,
        ),
    },
    {
      name: "StockTransferLine",
      run: () =>
        expect(
          fromStockTransferLineDto(toStockTransferLineDto(stockTransferLine)),
        ).toEqual(stockTransferLine),
    },
    {
      name: "StockTransferLeg",
      run: () =>
        expect(fromStockTransferLegDto(toStockTransferLegDto(stockTransferLeg))).toEqual(
          stockTransferLeg,
        ),
    },
    {
      name: "StockAdjustment",
      run: () =>
        expect(
          fromStockAdjustmentDto(toStockAdjustmentDto(stockAdjustment)),
        ).toEqual(stockAdjustment),
    },
    {
      name: "StockAdjustmentLine",
      run: () =>
        expect(
          fromStockAdjustmentLineDto(toStockAdjustmentLineDto(stockAdjustmentLine)),
        ).toEqual(stockAdjustmentLine),
    },
    {
      name: "AuditLog",
      run: () => expect(fromAuditLogDto(toAuditLogDto(auditLog))).toEqual(auditLog),
    },
  ];

  for (const { name, run } of conversionChecks) {
    it(`${name} converts to DTO and back without losing data`, run);
  }
});
