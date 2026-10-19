import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  lagosDateStringSchema,
  nonnegativeKoboStringSchema,
  paymentMethodSchema,
  positiveKoboStringSchema,
} from "./common.ts";
import { stockLocationSchema, stockMovementTypeSchema } from "./stock.ts";
import { unitSchema } from "./purchase.ts";

export const adminUserPublicDtoSchema = z
  .object({
    id: idSchema,
    email: z.string().email(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const auditLogDtoSchema = z
  .object({
    id: idSchema,
    actorId: idSchema.nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: idSchema,
    beforeData: z.unknown(),
    afterData: z.unknown(),
    metadata: z.unknown(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const stockTransferDtoSchema = z
  .object({
    id: idSchema,
    createdById: idSchema,
    from: stockLocationSchema,
    to: stockLocationSchema,
    reason: z.string().nullable(),
    reference: z.string().trim().nullable(),
    transferredAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const stockTransferLineDtoSchema = z
  .object({
    id: idSchema,
    transferId: idSchema,
    productId: idSchema,
    quantityUnits: z.number().int().positive(),
  })
  .strict();

export const stockTransferLegDtoSchema = z
  .object({
    id: idSchema,
    transferLineId: idSchema,
    location: stockLocationSchema,
    direction: z.enum(["IN", "OUT"]),
  })
  .strict();

export const stockAdjustmentDtoSchema = z
  .object({
    id: idSchema,
    createdById: idSchema,
    reason: z.string().min(1),
    status: z.enum(["COMPLETED", "VOIDED"]),
    adjustedAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const stockAdjustmentLineDtoSchema = z
  .object({
    id: idSchema,
    adjustmentId: idSchema,
    productId: idSchema,
    location: stockLocationSchema,
    quantityDeltaUnits: z.number().int().refine((value) => value !== 0),
    unitCostKobo: nonnegativeKoboStringSchema,
    reason: z.string().nullable(),
  })
  .strict();

export const createPurchaseLineDtoSchema = z
  .object({
    productId: idSchema,
    unit: unitSchema,
    /**
     * Fractional for PACK lines, so a wholesale purchase can be recorded as
     * half a crate (0.5 x 24 = 12 units). A UNIT line must resolve to whole
     * units; `receivePurchase` enforces that in scaled integer arithmetic.
     */
    quantity: z.number().positive(),
    lineTotalKobo: nonnegativeKoboStringSchema,
  })
  .strict();

export const createPurchaseDtoSchema = z
  .object({
    supplierId: idSchema.nullable(),
    location: stockLocationSchema,
    purchasedAt: isoDateTimeSchema,
    notes: z.string().trim().nullable(),
    reference: z.string().trim().nullable(),
    /**
     * Amount paid to the supplier at the moment of receiving. Must be between
     * 0 and the purchase total (checked in the domain). A balance above zero
     * requires a supplier so the debt can be tracked.
     */
    amountPaidNowKobo: nonnegativeKoboStringSchema,
    dueDate: lagosDateStringSchema.nullable(),
    /** How the up-front payment was made. Defaults to CASH. */
    paymentMethod: paymentMethodSchema.optional(),
    /** The account the up-front payment left. Required by the domain when paid. */
    accountId: idSchema.nullable().optional(),
    lines: z.array(createPurchaseLineDtoSchema).min(1),
  })
  .strict();

export const recordPurchasePaymentDtoSchema = z
  .object({
    amountKobo: positiveKoboStringSchema,
    paidAt: isoDateTimeSchema,
    method: paymentMethodSchema,
    note: z.string().trim().nullable().optional(),
    /** The account the money left. Required by the domain. */
    accountId: idSchema.nullable().optional(),
  })
  .strict();

export const createTransferLineDtoSchema = z
  .object({
    productId: idSchema,
    quantityUnits: z.number().int().positive(),
  })
  .strict();

export const createTransferDtoSchema = z
  .object({
    from: stockLocationSchema,
    to: stockLocationSchema,
    reason: z.string().trim().nullable(),
    reference: z.string().trim().nullable().optional(),
    transferredAt: isoDateTimeSchema,
    lines: z.array(createTransferLineDtoSchema).min(1),
  })
  .strict();

export const createAdjustmentLineDtoSchema = z
  .object({
    productId: idSchema,
    location: stockLocationSchema,
    quantityDeltaUnits: z.number().int().refine((value) => value !== 0),
    unitCostKobo: nonnegativeKoboStringSchema.optional(),
  })
  .strict();

export const createAdjustmentDtoSchema = z
  .object({
    reason: z.string().trim().min(1),
    adjustedAt: isoDateTimeSchema,
    lines: z.array(createAdjustmentLineDtoSchema).min(1),
  })
  .strict();

export const stockMovementFilterDtoSchema = z
  .object({
    productId: idSchema.optional(),
    location: stockLocationSchema.optional(),
    type: stockMovementTypeSchema.optional(),
  })
  .strict();
