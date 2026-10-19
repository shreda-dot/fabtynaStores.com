import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  lagosDateStringSchema,
  nonnegativeKoboStringSchema,
  paymentMethodSchema,
  positiveKoboStringSchema,
  signedKoboStringSchema,
} from "./common.ts";

/* Supplier credit (payables) --------------------------------------------- */

export const supplierPaymentDtoSchema = z
  .object({
    id: idSchema,
    supplierId: idSchema,
    purchaseId: idSchema,
    accountId: idSchema,
    amountKobo: positiveKoboStringSchema,
    method: paymentMethodSchema,
    note: z.string().nullable(),
    paidAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const purchasePaymentStatusSchema = z.enum(["UNPAID", "PARTIAL", "PAID"]);

/* Loans ------------------------------------------------------------------ */

export const loanStatusSchema = z.enum(["ACTIVE", "PAID", "OVERDUE"]);

export const loanDtoSchema = z
  .object({
    id: idSchema,
    lenderName: z.string().trim().min(1),
    principalKobo: positiveKoboStringSchema,
    agreedInterestKobo: nonnegativeKoboStringSchema,
    disbursedAt: isoDateTimeSchema,
    dueDate: lagosDateStringSchema.nullable(),
    note: z.string().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const loanLedgerEntryTypeSchema = z.enum([
  "DISBURSEMENT",
  "CHARGE",
  "REPAYMENT",
]);

export const loanLedgerEntryDtoSchema = z
  .object({
    id: idSchema,
    loanId: idSchema,
    type: loanLedgerEntryTypeSchema,
    amountKobo: signedKoboStringSchema,
    loanRepaymentId: idSchema.nullable(),
    reversesEntryId: idSchema.nullable(),
    note: z.string().nullable(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const loanRepaymentDtoSchema = z
  .object({
    id: idSchema,
    loanId: idSchema,
    amountKobo: positiveKoboStringSchema,
    interestPortionKobo: nonnegativeKoboStringSchema,
    note: z.string().nullable(),
    paidAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const createLoanDtoSchema = z
  .object({
    lenderName: z.string().trim().min(1),
    principalKobo: positiveKoboStringSchema,
    agreedInterestKobo: nonnegativeKoboStringSchema,
    disbursedAt: isoDateTimeSchema,
    dueDate: lagosDateStringSchema.nullable(),
    note: z.string().trim().nullable(),
    /** The account the loan money landed in. Required by the domain. */
    accountId: idSchema.nullable().optional(),
  })
  .strict();

export const addLoanChargeDtoSchema = z
  .object({
    amountKobo: positiveKoboStringSchema,
    reason: z.string().trim().min(1),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const recordLoanRepaymentDtoSchema = z
  .object({
    amountKobo: positiveKoboStringSchema,
    interestPortionKobo: nonnegativeKoboStringSchema,
    paidAt: isoDateTimeSchema,
    note: z.string().trim().nullable().optional(),
    /** The account the money left. Required by the domain. */
    accountId: idSchema.nullable().optional(),
  })
  .strict();

/* Cash ------------------------------------------------------------------- */

export const cashSnapshotDtoSchema = z
  .object({
    id: idSchema,
    asOfDate: lagosDateStringSchema,
    amountKobo: nonnegativeKoboStringSchema,
    note: z.string().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const createCashSnapshotDtoSchema = z
  .object({
    asOfDate: lagosDateStringSchema,
    amountKobo: nonnegativeKoboStringSchema,
    note: z.string().trim().nullable(),
  })
  .strict();

/* Financial position ----------------------------------------------------- */

const basisPointsSchema = z.number().int().min(0).max(10000);

export const accountingPositionOptionsDtoSchema = z
  .object({
    stockDiscountBps: basisPointsSchema.optional(),
    receivablesCollectibleBps: basisPointsSchema.optional(),
    includeReceivables: z.boolean().optional(),
    includeCash: z.boolean().optional(),
  })
  .strict();
