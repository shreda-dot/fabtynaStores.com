import { z } from "zod";
import { idSchema, isoDateTimeSchema, lagosDateStringSchema, positiveKoboStringSchema } from "@fabtyna/shared";
import { IDEMPOTENCY_KEY_PATTERN } from "../../lib/idempotency.js";

export const accountIdParamsSchema = z.object({ id: idSchema }).strict();
export const accountEntryIdParamsSchema = z.object({ id: idSchema }).strict();

export const createAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(["CASH", "BANK", "POS"]),
  })
  .strict();
export const renameAccountSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export const openingBalanceSchema = z
  .object({
    amountKobo: positiveKoboStringSchema,
    occurredAt: isoDateTimeSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const reconcileAccountSchema = z
  .object({
    countedAmountKobo: z.string().regex(/^(0|[1-9]\d*)$/, "Enter a non-negative integer kobo amount."),
    reason: z.string().trim().min(1).max(500),
    occurredAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const accountMovementSchema = z
  .object({
    type: z.enum(["OWNER_CAPITAL", "OWNER_DRAWING", "OTHER_INCOME", "BANK_OR_POS_CHARGE"]),
    amountKobo: positiveKoboStringSchema,
    note: z.string().trim().max(500).optional(),
    occurredAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const accountTransferSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amountKobo: positiveKoboStringSchema,
    note: z.string().trim().max(500).optional(),
    occurredAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const reversalReasonSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export const accountStatementQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const accountIdempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    "Idempotency-Key must be 8-128 characters: letters, digits, '.', '_', ':' or '-'.",
  );

export const accountListQuerySchema = z.object({ includeInactive: z.enum(["true", "false"]).transform((value) => value === "true").default(false) }).strict();
