import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  lagosDateStringSchema,
  positiveKoboStringSchema,
} from "@fabtyna/shared";
import { IDEMPOTENCY_KEY_PATTERN } from "../../lib/idempotency.js";

export const expenseIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const createExpenseSchema = z
  .object({
    categoryId: idSchema,
    channel: z.enum(["RETAIL", "WHOLESALE", "BOTH"]),
    description: z.string().trim().min(1).max(500),
    amountKobo: positiveKoboStringSchema,
    expenseDate: isoDateTimeSchema,
    accountId: idSchema,
  })
  .strict();
export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;

export const expenseVoidBodySchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const listExpensesQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    categoryId: z
      .union([idSchema, z.array(idSchema).min(1).max(50)])
      .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]))
      .optional(),
    channel: z.enum(["RETAIL", "WHOLESALE", "BOTH"]).optional(),
    accountId: idSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    includeVoided: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict();
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const expenseSummaryQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    categoryId: idSchema.optional(),
    channel: z.enum(["RETAIL", "WHOLESALE"]).optional(),
    accountId: idSchema.optional(),
  })
  .strict();
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;

export const expenseIdempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    "Idempotency-Key must be 8-128 characters: letters, digits, '.', '_', ':' or '-'.",
  );
