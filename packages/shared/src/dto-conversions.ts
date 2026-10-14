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
} from "./domain/types.ts";
import {
  auditLogDtoSchema,
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
} from "./schemas/index.ts";
import type {
  AuditLogDto,
  ProductDto,
  PurchaseDto,
  PurchaseLineDto,
  StockAdjustmentDto,
  StockAdjustmentLineDto,
  StockMovementDto,
  StockTransferDto,
  StockTransferLegDto,
  StockTransferLineDto,
  SupplierDto,
  SupplierLedgerEntryDto,
} from "./dtos.ts";

function dateToIso(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Cannot serialize an invalid date.");
  }
  return date.toISOString();
}

export function toProductDto(product: Product): ProductDto {
  return productDtoSchema.parse({
    ...product,
    retailPriceKobo: product.retailPriceKobo.toString(),
    wholesalePriceKobo: product.wholesalePriceKobo.toString(),
    averageCostKobo: product.averageCostKobo.toString(),
    deletedAt: product.deletedAt === null ? null : dateToIso(product.deletedAt),
    createdAt: dateToIso(product.createdAt),
    updatedAt: dateToIso(product.updatedAt),
  });
}

export function fromProductDto(dto: ProductDto): Product {
  const value = productDtoSchema.parse(dto);
  return {
    ...value,
    retailPriceKobo: BigInt(value.retailPriceKobo),
    wholesalePriceKobo: BigInt(value.wholesalePriceKobo),
    averageCostKobo: BigInt(value.averageCostKobo),
    deletedAt: value.deletedAt === null ? null : new Date(value.deletedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toSupplierDto(supplier: Supplier): SupplierDto {
  return supplierDtoSchema.parse({
    ...supplier,
    deletedAt: supplier.deletedAt === null ? null : dateToIso(supplier.deletedAt),
    createdAt: dateToIso(supplier.createdAt),
    updatedAt: dateToIso(supplier.updatedAt),
  });
}

export function fromSupplierDto(dto: SupplierDto): Supplier {
  const value = supplierDtoSchema.parse(dto);
  return {
    ...value,
    deletedAt: value.deletedAt === null ? null : new Date(value.deletedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toSupplierLedgerEntryDto(
  entry: SupplierLedgerEntry,
): SupplierLedgerEntryDto {
  return supplierLedgerEntryDtoSchema.parse({
    ...entry,
    amountKobo: entry.amountKobo.toString(),
    occurredAt: dateToIso(entry.occurredAt),
  });
}

export function fromSupplierLedgerEntryDto(
  dto: SupplierLedgerEntryDto,
): SupplierLedgerEntry {
  const value = supplierLedgerEntryDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    occurredAt: new Date(value.occurredAt),
  };
}

export function toStockMovementDto(movement: StockMovement): StockMovementDto {
  return stockMovementDtoSchema.parse({
    ...movement,
    unitCostKobo: movement.unitCostKobo.toString(),
    occurredAt: dateToIso(movement.occurredAt),
    createdAt: dateToIso(movement.createdAt),
  });
}

export function fromStockMovementDto(dto: StockMovementDto): StockMovement {
  const value = stockMovementDtoSchema.parse(dto);
  return {
    ...value,
    unitCostKobo: BigInt(value.unitCostKobo),
    occurredAt: new Date(value.occurredAt),
    createdAt: new Date(value.createdAt),
  };
}

export function toPurchaseDto(purchase: Purchase): PurchaseDto {
  return purchaseDtoSchema.parse({
    ...purchase,
    totalKobo: purchase.totalKobo.toString(),
    purchasedAt: dateToIso(purchase.purchasedAt),
    receivedAt: purchase.receivedAt === null ? null : dateToIso(purchase.receivedAt),
    createdAt: dateToIso(purchase.createdAt),
    updatedAt: dateToIso(purchase.updatedAt),
  });
}

export function fromPurchaseDto(dto: PurchaseDto): Purchase {
  const value = purchaseDtoSchema.parse(dto);
  return {
    ...value,
    totalKobo: BigInt(value.totalKobo),
    purchasedAt: new Date(value.purchasedAt),
    receivedAt: value.receivedAt === null ? null : new Date(value.receivedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toPurchaseLineDto(line: PurchaseLine): PurchaseLineDto {
  return purchaseLineDtoSchema.parse({
    ...line,
    unitCostKobo: line.unitCostKobo.toString(),
    lineTotalKobo: line.lineTotalKobo.toString(),
  });
}

export function fromPurchaseLineDto(dto: PurchaseLineDto): PurchaseLine {
  const value = purchaseLineDtoSchema.parse(dto);
  return {
    ...value,
    unitCostKobo: BigInt(value.unitCostKobo),
    lineTotalKobo: BigInt(value.lineTotalKobo),
  };
}

export function toStockTransferDto(transfer: StockTransfer): StockTransferDto {
  return stockTransferDtoSchema.parse({
    ...transfer,
    transferredAt: dateToIso(transfer.transferredAt),
    createdAt: dateToIso(transfer.createdAt),
  });
}

export function fromStockTransferDto(dto: StockTransferDto): StockTransfer {
  const value = stockTransferDtoSchema.parse(dto);
  return {
    ...value,
    transferredAt: new Date(value.transferredAt),
    createdAt: new Date(value.createdAt),
  };
}

export function toStockTransferLineDto(
  line: StockTransferLine,
): StockTransferLineDto {
  return stockTransferLineDtoSchema.parse(line);
}

export function fromStockTransferLineDto(
  dto: StockTransferLineDto,
): StockTransferLine {
  return stockTransferLineDtoSchema.parse(dto);
}

export function toStockTransferLegDto(
  leg: StockTransferLeg,
): StockTransferLegDto {
  return stockTransferLegDtoSchema.parse(leg);
}

export function fromStockTransferLegDto(
  dto: StockTransferLegDto,
): StockTransferLeg {
  return stockTransferLegDtoSchema.parse(dto);
}

export function toStockAdjustmentDto(
  adjustment: StockAdjustment,
): StockAdjustmentDto {
  return stockAdjustmentDtoSchema.parse({
    ...adjustment,
    adjustedAt: dateToIso(adjustment.adjustedAt),
    createdAt: dateToIso(adjustment.createdAt),
  });
}

export function fromStockAdjustmentDto(
  dto: StockAdjustmentDto,
): StockAdjustment {
  const value = stockAdjustmentDtoSchema.parse(dto);
  return {
    ...value,
    adjustedAt: new Date(value.adjustedAt),
    createdAt: new Date(value.createdAt),
  };
}

export function toStockAdjustmentLineDto(
  line: StockAdjustmentLine,
): StockAdjustmentLineDto {
  return stockAdjustmentLineDtoSchema.parse({
    ...line,
    unitCostKobo: line.unitCostKobo.toString(),
  });
}

export function fromStockAdjustmentLineDto(
  dto: StockAdjustmentLineDto,
): StockAdjustmentLine {
  const value = stockAdjustmentLineDtoSchema.parse(dto);
  return {
    ...value,
    unitCostKobo: BigInt(value.unitCostKobo),
  };
}

export function toAuditLogDto(log: AuditLog): AuditLogDto {
  return auditLogDtoSchema.parse({
    ...log,
    occurredAt: dateToIso(log.occurredAt),
  });
}

export function fromAuditLogDto(dto: AuditLogDto): AuditLog {
  const value = auditLogDtoSchema.parse(dto);
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
  };
}
