import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.ts";

export const productCategorySchema = z.enum(["BEER", "SOFT_DRINK", "OTHER"]);

export const saleChannelSchema = z.enum(["RETAIL", "WHOLESALE", "BOTH"]);

export const productDtoSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    sku: z.string().nullable(),
    category: productCategorySchema,
    packName: z.string(),
    unitsPerPack: z.number().int().positive(),
    saleChannel: saleChannelSchema,
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
    sku: z
      .string()
      .trim()
      .nullable()
      .transform((value) => {
        if (value === null) return null;
        const upper = value.toUpperCase();
        return upper === "" ? null : upper;
      }),
    category: productCategorySchema,
    packName: z.string().trim().min(1),
    unitsPerPack: z.number().int().positive(),
    saleChannel: saleChannelSchema,
    retailPriceKobo: nonnegativeKoboStringSchema,
    wholesalePriceKobo: nonnegativeKoboStringSchema,
    reorderLevelUnits: z.number().int().nonnegative(),
  })
  .strict();
