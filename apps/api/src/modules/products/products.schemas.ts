import { z } from "zod";
import { idSchema, nonnegativeKoboStringSchema } from "@fabtyna/shared";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../sales/sales.schemas.js";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const productIdParamsSchema = z.object({ id: idSchema }).strict();

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    sku: z.string().trim().max(80).optional().transform((value) => value?.toUpperCase() || null),
    category: z.enum(["BEER", "SOFT_DRINK", "OTHER"]),
    packName: z.string().trim().min(1).max(40),
    unitsPerPack: z.number().int().positive(),
    saleChannel: z.enum(["RETAIL", "WHOLESALE", "BOTH"]),
    retailPriceKobo: nonnegativeKoboStringSchema,
    wholesalePriceKobo: nonnegativeKoboStringSchema,
    reorderLevelUnits: z.number().int().nonnegative(),
  })
  .strict();

export const patchProductSchema = createProductSchema
  .omit({ unitsPerPack: true })
  .partial()
  .extend({ unitsPerPack: z.number().int().positive().optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required.");

export const listProductsQuerySchema = z
  .object({
    q: optionalText(100),
    category: z.enum(["BEER", "SOFT_DRINK", "OTHER"]).optional(),
    saleChannel: z.enum(["RETAIL", "WHOLESALE", "BOTH"]).optional(),
    active: z.enum(["true", "false"]).transform((value) => value === "true").default(true),
    lowStock: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    cursor: optionalText(400),
  })
  .strict();

export type CreateProductBody = z.infer<typeof createProductSchema>;
export type PatchProductBody = z.infer<typeof patchProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
