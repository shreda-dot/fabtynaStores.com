import type { z } from "zod";
import {
  accountLedgerEntryDtoSchema,
  adminUserPublicDtoSchema,
  auditLogDtoSchema,
  customerDtoSchema,
  customerLedgerEntryDtoSchema,
  productDtoSchema,
  purchaseDtoSchema,
  purchaseLineDtoSchema,
  purchaseReceiveDtoSchema,
  stockAdjustmentDtoSchema,
  stockAdjustmentLineDtoSchema,
  stockMovementDtoSchema,
  stockTransferDtoSchema,
  stockTransferLegDtoSchema,
  stockTransferLineDtoSchema,
  supplierDtoSchema,
  supplierLedgerEntryDtoSchema,
  createProductDtoSchema,
  createSupplierDtoSchema,
} from "./schemas/index.ts";

export type AdminUserPublicDto = z.infer<typeof adminUserPublicDtoSchema>;
export type AuditLogDto = z.infer<typeof auditLogDtoSchema>;
export type ProductDto = z.infer<typeof productDtoSchema>;
export type SupplierDto = z.infer<typeof supplierDtoSchema>;
export type CustomerDto = z.infer<typeof customerDtoSchema>;
export type PurchaseDto = z.infer<typeof purchaseDtoSchema>;
export type PurchaseLineDto = z.infer<typeof purchaseLineDtoSchema>;
export type StockTransferDto = z.infer<typeof stockTransferDtoSchema>;
export type StockTransferLineDto = z.infer<typeof stockTransferLineDtoSchema>;
export type StockTransferLegDto = z.infer<typeof stockTransferLegDtoSchema>;
export type StockAdjustmentDto = z.infer<typeof stockAdjustmentDtoSchema>;
export type StockAdjustmentLineDto = z.infer<typeof stockAdjustmentLineDtoSchema>;
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;
export type CustomerLedgerEntryDto = z.infer<typeof customerLedgerEntryDtoSchema>;
export type SupplierLedgerEntryDto = z.infer<typeof supplierLedgerEntryDtoSchema>;
export type AccountLedgerEntryDto = z.infer<typeof accountLedgerEntryDtoSchema>;
export type PurchaseReceiveDto = z.infer<typeof purchaseReceiveDtoSchema>;
export type CreateProductDto = z.infer<typeof createProductDtoSchema>;
export type CreateSupplierDto = z.infer<typeof createSupplierDtoSchema>;
