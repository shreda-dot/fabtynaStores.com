import { z } from "zod";
import { idSchema, isoDateTimeSchema, lagosDateStringSchema } from "@fabtyna/shared";
import { IDEMPOTENCY_KEY_PATTERN } from "../../lib/idempotency.js";

export const stockIdParamsSchema = z.object({ id: idSchema }).strict();

export const stockIdempotencyKeySchema = z.string().regex(
  IDEMPOTENCY_KEY_PATTERN,
  "Idempotency-Key must be 8-128 characters: letters, digits, '.', '_', ':' or '-'.",
);

const stockLocationSchema = z.enum(["WAREHOUSE", "RETAIL_SHELF", "MARKET"]);
const transferQuantitySchema = z.number().int().safe().positive().max(2_147_483_647);
const adjustmentQuantitySchema = z
  .number()
  .int()
  .safe()
  .min(-2_147_483_648)
  .max(2_147_483_647)
  .refine((value) => value !== 0);
const koboAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);

export const createTransferSchema = z
  .object({
    from: stockLocationSchema,
    to: stockLocationSchema,
    reason: z.string().trim().max(500).nullable().optional(),
    transferredAt: isoDateTimeSchema.optional(),
    lines: z
      .array(
        z.object({
          productId: idSchema,
          quantityUnits: transferQuantitySchema,
        }).strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine((body) => body.from !== body.to, {
    message: "A stock transfer must move stock between two different locations.",
    path: ["to"],
  });
export type CreateTransferBody = z.infer<typeof createTransferSchema>;

export const listTransfersQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    fromLocation: stockLocationSchema.optional(),
    toLocation: stockLocationSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;

export const createAdjustmentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    adjustedAt: isoDateTimeSchema.optional(),
    lines: z
      .array(
        z
          .object({
            productId: idSchema,
            location: stockLocationSchema,
            quantityDeltaUnits: adjustmentQuantitySchema,
            unitCostKobo: koboAmountSchema.optional(),
            reason: z.string().trim().min(1).max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type CreateAdjustmentBody = z.infer<typeof createAdjustmentSchema>;

export const listAdjustmentsQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    location: stockLocationSchema.optional(),
    status: z.enum(["COMPLETED", "VOIDED"]).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListAdjustmentsQuery = z.infer<typeof listAdjustmentsQuerySchema>;
