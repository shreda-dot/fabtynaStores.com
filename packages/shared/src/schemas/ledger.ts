import { z } from "zod";
import { idSchema, isoDateTimeSchema, signedKoboStringSchema } from "./common.ts";

export const customerLedgerEntryTypeSchema = z.enum([
  "SALE",
  "PAYMENT",
  "RETURN",
  "CUSTOMER_REFUND",
  "ADJUSTMENT",
]);

export const supplierLedgerEntryTypeSchema = z.enum([
  "PURCHASE",
  "PAYMENT",
  "ADJUSTMENT",
]);

export const accountLedgerEntryTypeSchema = z.enum([
  "SALE_PAYMENT",
  "CUSTOMER_PAYMENT",
  "SUPPLIER_PAYMENT",
  "EXPENSE",
  "CUSTOMER_REFUND",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "OWNER_CAPITAL",
  "OWNER_DRAWING",
  "OTHER_INCOME",
  "BANK_OR_POS_CHARGE",
  "ADJUSTMENT",
]);

export const customerLedgerEntryDtoSchema = z
  .object({
    id: idSchema,
    customerId: idSchema,
    type: customerLedgerEntryTypeSchema,
    amountKobo: signedKoboStringSchema,
    saleId: idSchema.nullable(),
    salePaymentId: idSchema.nullable(),
    customerPaymentId: idSchema.nullable(),
    saleReturnId: idSchema.nullable(),
    customerRefundId: idSchema.nullable(),
    reversesEntryId: idSchema.nullable(),
    note: z.string().nullable(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const supplierLedgerEntryDtoSchema = z
  .object({
    id: idSchema,
    supplierId: idSchema,
    type: supplierLedgerEntryTypeSchema,
    amountKobo: signedKoboStringSchema,
    purchaseId: idSchema.nullable(),
    supplierPaymentId: idSchema.nullable(),
    reversesEntryId: idSchema.nullable(),
    note: z.string().nullable(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const accountLedgerEntryDtoSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    type: accountLedgerEntryTypeSchema,
    amountKobo: signedKoboStringSchema,
    salePaymentId: idSchema.nullable(),
    customerPaymentId: idSchema.nullable(),
    supplierPaymentId: idSchema.nullable(),
    expenseId: idSchema.nullable(),
    otherIncomeId: idSchema.nullable(),
    accountTransferId: idSchema.nullable(),
    customerRefundId: idSchema.nullable(),
    reversesEntryId: idSchema.nullable(),
    note: z.string().nullable(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();
