import { z } from "zod";
import { idSchema, isoDateTimeSchema, nonnegativeKoboStringSchema } from "./common.ts";

export const stockLocationSchema = z.enum([
  "WAREHOUSE",
  "RETAIL_SHELF",
  "MARKET",
]);

export const stockMovementTypeSchema = z.enum([
  "PURCHASE",
  "SALE",
  "TRANSFER",
  "ADJUSTMENT",
  "RETURN",
]);

export const stockMovementDtoSchema = z
  .object({
    id: idSchema,
    productId: idSchema,
    location: stockLocationSchema,
    type: stockMovementTypeSchema,
    quantityUnits: z.number().int().refine((value) => value !== 0),
    unitCostKobo: nonnegativeKoboStringSchema,
    purchaseLineId: idSchema.nullable(),
    saleLineId: idSchema.nullable(),
    transferLegId: idSchema.nullable(),
    adjustmentLineId: idSchema.nullable(),
    returnLineId: idSchema.nullable(),
    reversesEntryId: idSchema.nullable(),
    occurredAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
