import type { z } from "zod";
import {
  accountLedgerEntryDtoSchema,
  adminUserPublicDtoSchema,
  auditLogDtoSchema,
  createAdjustmentDtoSchema,
  createCustomerDtoSchema,
  createExpenseDtoSchema,
  createPurchaseDtoSchema,
  createSaleDtoSchema,
  createSupplierDtoSchema,
  createTransferDtoSchema,
  customerDtoSchema,
  customerLedgerEntryDtoSchema,
  expenseDtoSchema,
  productDtoSchema,
  purchaseDtoSchema,
  purchaseLineDtoSchema,
  purchaseReceiveDtoSchema,
  saleDtoSchema,
  saleLineDtoSchema,
  salePaymentDtoSchema,
  stockAdjustmentDtoSchema,
  stockAdjustmentLineDtoSchema,
  stockMovementDtoSchema,
  stockMovementFilterDtoSchema,
  stockTransferDtoSchema,
  stockTransferLegDtoSchema,
  stockTransferLineDtoSchema,
  supplierDtoSchema,
  supplierLedgerEntryDtoSchema,
  createProductDtoSchema,
} from "./schemas/index.ts";

export type AdminUserPublicDto = z.infer<typeof adminUserPublicDtoSchema>;
export type AuditLogDto = z.infer<typeof auditLogDtoSchema>;
export type ProductDto = z.infer<typeof productDtoSchema>;
export type SupplierDto = z.infer<typeof supplierDtoSchema>;
export type CustomerDto = z.infer<typeof customerDtoSchema>;
export type ExpenseDto = z.infer<typeof expenseDtoSchema>;
export type PurchaseDto = z.infer<typeof purchaseDtoSchema>;
export type PurchaseLineDto = z.infer<typeof purchaseLineDtoSchema>;
export type SaleDto = z.infer<typeof saleDtoSchema>;
export type SaleLineDto = z.infer<typeof saleLineDtoSchema>;
export type SalePaymentDto = z.infer<typeof salePaymentDtoSchema>;
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
export type CreateCustomerDto = z.infer<typeof createCustomerDtoSchema>;
export type CreateExpenseDto = z.infer<typeof createExpenseDtoSchema>;
export type CreatePurchaseDto = z.infer<typeof createPurchaseDtoSchema>;
export type CreateSaleDto = z.infer<typeof createSaleDtoSchema>;
export type CreateTransferDto = z.infer<typeof createTransferDtoSchema>;
export type CreateAdjustmentDto = z.infer<typeof createAdjustmentDtoSchema>;
export type StockMovementFilterDto = z.infer<typeof stockMovementFilterDtoSchema>;
