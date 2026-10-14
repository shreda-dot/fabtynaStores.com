import { z } from "zod";
import type {
  AdminUserPublicDto,
  AuditLogDto,
  StockAdjustmentDto,
  StockAdjustmentLineDto,
  StockTransferDto,
  StockTransferLineDto,
  StockTransferLegDto,
} from "../dtos.js";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.js";
import { stockLocationSchema } from "./stock.js";

export const adminUserPublicDtoSchema: z.ZodType<AdminUserPublicDto> = z
  .object({
    id: idSchema,
    email: z.string().email(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const auditLogDtoSchema: z.ZodType<AuditLogDto> = z
  .object({
    id: idSchema,
    actorId: idSchema.nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: idSchema,
    beforeData: z.unknown().nullable(),
    afterData: z.unknown().nullable(),
    metadata: z.unknown().nullable(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const stockTransferDtoSchema: z.ZodType<StockTransferDto> = z
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

export const stockTransferLineDtoSchema: z.ZodType<StockTransferLineDto> = z
  .object({
    id: idSchema,
    transferId: idSchema,
    productId: idSchema,
    quantityUnits: z.number().int().positive(),
  })
  .strict();

export const stockTransferLegDtoSchema: z.ZodType<StockTransferLegDto> = z
  .object({
    id: idSchema,
    transferLineId: idSchema,
    location: stockLocationSchema,
    direction: z.enum(["IN", "OUT"]),
  })
  .strict();

export const stockAdjustmentDtoSchema: z.ZodType<StockAdjustmentDto> = z
  .object({
    id: idSchema,
    createdById: idSchema,
    reason: z.string().min(1),
    status: z.enum(["COMPLETED", "VOIDED"]),
    adjustedAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const stockAdjustmentLineDtoSchema: z.ZodType<StockAdjustmentLineDto> = z
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
