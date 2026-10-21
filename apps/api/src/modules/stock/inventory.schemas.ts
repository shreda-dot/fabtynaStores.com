import { z } from "zod";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../sales/sales.schemas.js";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const inventoryQuerySchema = z
  .object({
    q: optionalText(100),
    location: z.enum(["WAREHOUSE", "RETAIL_SHELF", "MARKET"]).optional(),
    active: booleanQuery.default(true),
    nonZero: booleanQuery.default(true),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    cursor: optionalText(400),
  })
  .strict();

export const lowStockQuerySchema = z
  .object({
    q: optionalText(100),
    location: z.enum(["WAREHOUSE", "RETAIL_SHELF", "MARKET"]).optional(),
    active: booleanQuery.default(true),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    cursor: optionalText(400),
  })
  .strict();

export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;
