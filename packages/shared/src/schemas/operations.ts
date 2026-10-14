import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.ts";
import { stockLocationSchema } from "./stock.ts";

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
