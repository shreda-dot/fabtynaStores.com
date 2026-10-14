import { z } from "zod";
import type { PurchaseDto, PurchaseLineDto, PurchaseReceiveDto } from "../dtos.js";
import { idSchema, isoDateTimeSchema, nonnegativeKoboStringSchema } from "./common.js";

export const purchaseStatusSchema = z.enum(["DRAFT", "RECEIVED", "VOIDED"]);
export const unitSchema = z.enum(["UNIT", "PACK"]);

export const purchaseLineDtoSchema: z.ZodType<PurchaseLineDto> = z
  .object({
    id: idSchema,
    purchaseId: idSchema,
    productId: idSchema,
    unit: unitSchema,
    quantity: z.number().int().positive(),
    unitsPerPackSnapshot: z.number().int().positive(),
    quantityUnits: z.number().int().positive(),
    unitCostKobo: nonnegativeKoboStringSchema,
    lineTotalKobo: nonnegativeKoboStringSchema,
  })
  .strict();

export const purchaseDtoSchema: z.ZodType<PurchaseDto> = z
  .object({
    id: idSchema,
    supplierId: idSchema.nullable(),
    createdById: idSchema,
    status: purchaseStatusSchema,
    reference: z.string().nullable(),
    notes: z.string().nullable(),
    totalKobo: nonnegativeKoboStringSchema,
    purchasedAt: isoDateTimeSchema,
    receivedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const purchaseReceiveDtoSchema: z.ZodType<PurchaseReceiveDto> = z
  .object({
    lines: z
      .array(
        z
          .object({
            purchaseLineId: idSchema,
            quantityUnits: z.number().int().positive(),
            // This is the total cost for the received line and is the value
            // used in the weighted-average cost calculation.
            lineTotalKobo: nonnegativeKoboStringSchema,
          })
          .strict(),
      )
      .min(1),
    receivedAt: isoDateTimeSchema.optional(),
  })
  .strict();
