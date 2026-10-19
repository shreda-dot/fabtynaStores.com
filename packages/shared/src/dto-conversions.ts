import type {
  Account,
  AccountLedgerEntry,
  AccountTransfer,
  AuditLog,
  CashSnapshot,
  Customer,
  CustomerLedgerEntry,
  Expense,
  Loan,
  LoanLedgerEntry,
  LoanRepayment,
  Product,
  Purchase,
  PurchaseLine,
  Sale,
  SaleLine,
  SalePayment,
  StockAdjustment,
  StockAdjustmentLine,
  StockMovement,
  StockTransfer,
  StockTransferLeg,
  StockTransferLine,
  Supplier,
  SupplierLedgerEntry,
  SupplierPayment,
} from "./domain/types.ts";
import {
  accountDtoSchema,
  accountLedgerEntryDtoSchema,
  accountTransferDtoSchema,
  auditLogDtoSchema,
  cashSnapshotDtoSchema,
  customerDtoSchema,
  customerLedgerEntryDtoSchema,
  expenseDtoSchema,
  loanDtoSchema,
  loanLedgerEntryDtoSchema,
  loanRepaymentDtoSchema,
  productDtoSchema,
  purchaseDtoSchema,
  purchaseLineDtoSchema,
  saleDtoSchema,
  saleLineDtoSchema,
  salePaymentDtoSchema,
  stockAdjustmentDtoSchema,
  stockAdjustmentLineDtoSchema,
  stockMovementDtoSchema,
  stockTransferDtoSchema,
  stockTransferLegDtoSchema,
  stockTransferLineDtoSchema,
  supplierDtoSchema,
  supplierLedgerEntryDtoSchema,
  supplierPaymentDtoSchema,
} from "./schemas/index.ts";
import type {
  AccountDto,
  AccountLedgerEntryDto,
  AccountTransferDto,
  AuditLogDto,
  CashSnapshotDto,
  CustomerDto,
  CustomerLedgerEntryDto,
  ExpenseDto,
  LoanDto,
  LoanLedgerEntryDto,
  LoanRepaymentDto,
  ProductDto,
  PurchaseDto,
  PurchaseLineDto,
  SaleDto,
  SaleLineDto,
  SalePaymentDto,
  StockAdjustmentDto,
  StockAdjustmentLineDto,
  StockMovementDto,
  StockTransferDto,
  StockTransferLegDto,
  StockTransferLineDto,
  SupplierDto,
  SupplierLedgerEntryDto,
  SupplierPaymentDto,
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
    paidKobo: purchase.paidKobo.toString(),
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
    paidKobo: BigInt(value.paidKobo),
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

export function toCustomerDto(customer: Customer): CustomerDto {
  return customerDtoSchema.parse({
    ...customer,
    creditLimitKobo: customer.creditLimitKobo.toString(),
    deletedAt: customer.deletedAt === null ? null : dateToIso(customer.deletedAt),
    createdAt: dateToIso(customer.createdAt),
    updatedAt: dateToIso(customer.updatedAt),
  });
}

export function fromCustomerDto(dto: CustomerDto): Customer {
  const value = customerDtoSchema.parse(dto);
  return {
    ...value,
    creditLimitKobo: BigInt(value.creditLimitKobo),
    deletedAt: value.deletedAt === null ? null : new Date(value.deletedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toCustomerLedgerEntryDto(
  entry: CustomerLedgerEntry,
): CustomerLedgerEntryDto {
  return customerLedgerEntryDtoSchema.parse({
    ...entry,
    amountKobo: entry.amountKobo.toString(),
    occurredAt: dateToIso(entry.occurredAt),
  });
}

export function fromCustomerLedgerEntryDto(
  dto: CustomerLedgerEntryDto,
): CustomerLedgerEntry {
  const value = customerLedgerEntryDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    occurredAt: new Date(value.occurredAt),
  };
}

export function toExpenseDto(expense: Expense): ExpenseDto {
  return expenseDtoSchema.parse({
    ...expense,
    amountKobo: expense.amountKobo.toString(),
    expenseDate: dateToIso(expense.expenseDate),
    voidedAt: expense.voidedAt === null ? null : dateToIso(expense.voidedAt),
    createdAt: dateToIso(expense.createdAt),
    updatedAt: dateToIso(expense.updatedAt),
  });
}

export function fromExpenseDto(dto: ExpenseDto): Expense {
  const value = expenseDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    expenseDate: new Date(value.expenseDate),
    voidedAt: value.voidedAt === null ? null : new Date(value.voidedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toSaleDto(sale: Sale): SaleDto {
  return saleDtoSchema.parse({
    ...sale,
    totalKobo: sale.totalKobo.toString(),
    paidKobo: sale.paidKobo.toString(),
    soldAt: dateToIso(sale.soldAt),
    createdAt: dateToIso(sale.createdAt),
    updatedAt: dateToIso(sale.updatedAt),
  });
}

export function fromSaleDto(dto: SaleDto): Sale {
  const value = saleDtoSchema.parse(dto);
  return {
    ...value,
    totalKobo: BigInt(value.totalKobo),
    paidKobo: BigInt(value.paidKobo),
    soldAt: new Date(value.soldAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toSaleLineDto(line: SaleLine): SaleLineDto {
  return saleLineDtoSchema.parse({
    ...line,
    unitPriceKobo: line.unitPriceKobo.toString(),
    lineTotalKobo: line.lineTotalKobo.toString(),
  });
}

export function fromSaleLineDto(dto: SaleLineDto): SaleLine {
  const value = saleLineDtoSchema.parse(dto);
  return {
    ...value,
    unitPriceKobo: BigInt(value.unitPriceKobo),
    lineTotalKobo: BigInt(value.lineTotalKobo),
  };
}

export function toSalePaymentDto(payment: SalePayment): SalePaymentDto {
  return salePaymentDtoSchema.parse({
    ...payment,
    amountKobo: payment.amountKobo.toString(),
    paidAt: dateToIso(payment.paidAt),
    createdAt: dateToIso(payment.createdAt),
  });
}

export function fromSalePaymentDto(dto: SalePaymentDto): SalePayment {
  const value = salePaymentDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    paidAt: new Date(value.paidAt),
    createdAt: new Date(value.createdAt),
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

/* Accounting ------------------------------------------------------------- */

export function toSupplierPaymentDto(
  payment: SupplierPayment,
): SupplierPaymentDto {
  return supplierPaymentDtoSchema.parse({
    ...payment,
    amountKobo: payment.amountKobo.toString(),
    paidAt: dateToIso(payment.paidAt),
    createdAt: dateToIso(payment.createdAt),
  });
}

export function fromSupplierPaymentDto(
  dto: SupplierPaymentDto,
): SupplierPayment {
  const value = supplierPaymentDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    paidAt: new Date(value.paidAt),
    createdAt: new Date(value.createdAt),
  };
}

export function toLoanDto(loan: Loan): LoanDto {
  return loanDtoSchema.parse({
    ...loan,
    principalKobo: loan.principalKobo.toString(),
    agreedInterestKobo: loan.agreedInterestKobo.toString(),
    disbursedAt: dateToIso(loan.disbursedAt),
    createdAt: dateToIso(loan.createdAt),
  });
}

export function fromLoanDto(dto: LoanDto): Loan {
  const value = loanDtoSchema.parse(dto);
  return {
    ...value,
    principalKobo: BigInt(value.principalKobo),
    agreedInterestKobo: BigInt(value.agreedInterestKobo),
    disbursedAt: new Date(value.disbursedAt),
    createdAt: new Date(value.createdAt),
  };
}

export function toLoanLedgerEntryDto(
  entry: LoanLedgerEntry,
): LoanLedgerEntryDto {
  return loanLedgerEntryDtoSchema.parse({
    ...entry,
    amountKobo: entry.amountKobo.toString(),
    occurredAt: dateToIso(entry.occurredAt),
  });
}

export function fromLoanLedgerEntryDto(
  dto: LoanLedgerEntryDto,
): LoanLedgerEntry {
  const value = loanLedgerEntryDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    occurredAt: new Date(value.occurredAt),
  };
}

export function toLoanRepaymentDto(
  repayment: LoanRepayment,
): LoanRepaymentDto {
  return loanRepaymentDtoSchema.parse({
    ...repayment,
    amountKobo: repayment.amountKobo.toString(),
    interestPortionKobo: repayment.interestPortionKobo.toString(),
    paidAt: dateToIso(repayment.paidAt),
    createdAt: dateToIso(repayment.createdAt),
  });
}

export function fromLoanRepaymentDto(dto: LoanRepaymentDto): LoanRepayment {
  const value = loanRepaymentDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    interestPortionKobo: BigInt(value.interestPortionKobo),
    paidAt: new Date(value.paidAt),
    createdAt: new Date(value.createdAt),
  };
}

export function toCashSnapshotDto(snapshot: CashSnapshot): CashSnapshotDto {
  return cashSnapshotDtoSchema.parse({
    ...snapshot,
    amountKobo: snapshot.amountKobo.toString(),
    createdAt: dateToIso(snapshot.createdAt),
  });
}

export function fromCashSnapshotDto(dto: CashSnapshotDto): CashSnapshot {
  const value = cashSnapshotDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    createdAt: new Date(value.createdAt),
  };
}

/* Accounts --------------------------------------------------------------- */

export function toAccountDto(account: Account): AccountDto {
  return accountDtoSchema.parse({
    ...account,
    deactivatedAt:
      account.deactivatedAt === null ? null : dateToIso(account.deactivatedAt),
    createdAt: dateToIso(account.createdAt),
    updatedAt: dateToIso(account.updatedAt),
  });
}

export function fromAccountDto(dto: AccountDto): Account {
  const value = accountDtoSchema.parse(dto);
  return {
    ...value,
    deactivatedAt:
      value.deactivatedAt === null ? null : new Date(value.deactivatedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function toAccountLedgerEntryDto(
  entry: AccountLedgerEntry,
): AccountLedgerEntryDto {
  return accountLedgerEntryDtoSchema.parse({
    ...entry,
    amountKobo: entry.amountKobo.toString(),
    occurredAt: dateToIso(entry.occurredAt),
  });
}

export function fromAccountLedgerEntryDto(
  dto: AccountLedgerEntryDto,
): AccountLedgerEntry {
  const value = accountLedgerEntryDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    occurredAt: new Date(value.occurredAt),
  };
}

export function toAccountTransferDto(
  transfer: AccountTransfer,
): AccountTransferDto {
  return accountTransferDtoSchema.parse({
    ...transfer,
    amountKobo: transfer.amountKobo.toString(),
    occurredAt: dateToIso(transfer.occurredAt),
    createdAt: dateToIso(transfer.createdAt),
  });
}

export function fromAccountTransferDto(
  dto: AccountTransferDto,
): AccountTransfer {
  const value = accountTransferDtoSchema.parse(dto);
  return {
    ...value,
    amountKobo: BigInt(value.amountKobo),
    occurredAt: new Date(value.occurredAt),
    createdAt: new Date(value.createdAt),
  };
}
