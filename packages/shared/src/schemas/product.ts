import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.ts";

export const productCategorySchema = z.enum(["BEER", "SOFT_DRINK", "OTHER"]);

export const productDtoSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    sku: z.string().nullable(),
    category: productCategorySchema,
    packName: z.string(),
    unitsPerPack: z.number().int().positive(),
    retailPriceKobo: nonnegativeKoboStringSchema,
    wholesalePriceKobo: nonnegativeKoboStringSchema,
    averageCostKobo: nonnegativeKoboStringSchema,
    reorderLevelUnits: z.number().int().nonnegative(),
    deletedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const createProductDtoSchema = z
  .object({
    name: z.string().trim().min(1),
    sku: z.string().trim().nullable(),
    category: productCategorySchema,
    packName: z.string().trim().min(1),
    unitsPerPack: z.number().int().positive(),
    retailPriceKobo: nonnegativeKoboStringSchema,
    wholesalePriceKobo: nonnegativeKoboStringSchema,
    reorderLevelUnits: z.number().int().nonnegative(),
  })
  .strict();
