import { z } from "zod";
import { IDEMPOTENCY_KEY_PATTERN } from "../../lib/idempotency.js";

export const expenseCategoryIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const expenseCategoryListQuerySchema = z
  .object({
    includeInactive: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  })
  .strict();

export const createExpenseCategorySchema = z
  .object({ name: z.string().trim().min(1).max(60) })
  .strict();

export const renameExpenseCategorySchema = createExpenseCategorySchema;

export const expenseIdempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    "Idempotency-Key must be 8-128 characters: letters, digits, '.', '_', ':' or '-'.",
  );
