import type { z } from "zod";
import {
  accountDtoSchema,
  accountLedgerEntryDtoSchema,
  accountTransferDtoSchema,
  accountingPositionOptionsDtoSchema,
  addLoanChargeDtoSchema,
  adminUserPublicDtoSchema,
  auditLogDtoSchema,
  cashSnapshotDtoSchema,
  createAccountDtoSchema,
  createAccountTransferDtoSchema,
  createAdjustmentDtoSchema,
  createCashSnapshotDtoSchema,
  createCustomerDtoSchema,
  createExpenseDtoSchema,
  createLoanDtoSchema,
  createOpeningBalanceDtoSchema,
  createPurchaseDtoSchema,
  createSaleDtoSchema,
  createSupplierDtoSchema,
  createTransferDtoSchema,
  customerDtoSchema,
  deactivateAccountDtoSchema,
  reconcileAccountDtoSchema,
  updateAccountDtoSchema,
  customerLedgerEntryDtoSchema,
  expenseDtoSchema,
  loanDtoSchema,
  loanLedgerEntryDtoSchema,
  loanRepaymentDtoSchema,
  productDtoSchema,
  purchaseDtoSchema,
  purchaseLineDtoSchema,
  purchaseReceiveDtoSchema,
  recordLoanRepaymentDtoSchema,
  recordPurchasePaymentDtoSchema,
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
  supplierPaymentDtoSchema,
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

/* Accounting ------------------------------------------------------------- */

export type SupplierPaymentDto = z.infer<typeof supplierPaymentDtoSchema>;
export type LoanDto = z.infer<typeof loanDtoSchema>;
export type LoanLedgerEntryDto = z.infer<typeof loanLedgerEntryDtoSchema>;
export type LoanRepaymentDto = z.infer<typeof loanRepaymentDtoSchema>;
export type CashSnapshotDto = z.infer<typeof cashSnapshotDtoSchema>;
export type CreateLoanDto = z.infer<typeof createLoanDtoSchema>;
export type AddLoanChargeDto = z.infer<typeof addLoanChargeDtoSchema>;
export type RecordLoanRepaymentDto = z.infer<
  typeof recordLoanRepaymentDtoSchema
>;
export type RecordPurchasePaymentDto = z.infer<
  typeof recordPurchasePaymentDtoSchema
>;
export type CreateCashSnapshotDto = z.infer<typeof createCashSnapshotDtoSchema>;
export type AccountingPositionOptionsDto = z.infer<
  typeof accountingPositionOptionsDtoSchema
>;

/* Accounts --------------------------------------------------------------- */

export type AccountDto = z.infer<typeof accountDtoSchema>;
export type AccountTransferDto = z.infer<typeof accountTransferDtoSchema>;
export type CreateAccountDto = z.infer<typeof createAccountDtoSchema>;
export type UpdateAccountDto = z.infer<typeof updateAccountDtoSchema>;
export type CreateAccountTransferDto = z.infer<
  typeof createAccountTransferDtoSchema
>;
export type CreateOpeningBalanceDto = z.infer<
  typeof createOpeningBalanceDtoSchema
>;
export type ReconcileAccountDto = z.infer<typeof reconcileAccountDtoSchema>;
export type DeactivateAccountDto = z.infer<typeof deactivateAccountDtoSchema>;
