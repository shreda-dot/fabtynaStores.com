import { z } from "zod";
import {
  createSaleDtoSchema,
  idSchema,
  isoDateTimeSchema,
  lagosDateStringSchema,
  positiveKoboStringSchema,
} from "@fabtyna/shared";
import { IDEMPOTENCY_KEY_PATTERN } from "../../lib/idempotency.js";

export { createSaleDtoSchema };
export type CreateSaleDto = z.infer<typeof createSaleDtoSchema>;

export const idempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    "Idempotency-Key must be 8-128 characters: letters, digits, '.', '_', ':' or '-'.",
  );

export const saleIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

/** Params of POST /sales/:id/payments/:paymentId/reverse (and the purchases twin). */
export const paymentReversalParamsSchema = z
  .object({ id: z.string().min(1), paymentId: z.string().min(1) })
  .strict();

/** Body of a payment reversal. The reason is mandatory; reversedAt defaults to now. */
export const reversePaymentBodySchema = z
  .object({
    reason: z.string().trim().min(1, "A reason is required.").max(500),
    reversedAt: isoDateTimeSchema.optional(),
  })
  .strict();
export type ReversePaymentBody = z.infer<typeof reversePaymentBodySchema>;

/** Body of POST /sales/:id/payments. Money is an integer kobo string, like every DTO. */
export const recordPaymentDtoSchema = z
  .object({
    amountKobo: positiveKoboStringSchema,
    accountId: idSchema,
    paidAt: isoDateTimeSchema,
  })
  .strict();
export type RecordPaymentDto = z.infer<typeof recordPaymentDtoSchema>;

export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LIST_LIMIT = 50;

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/** Query string of GET /sales. Everything is optional. */
export const listSalesQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    status: z.enum(["DRAFT", "COMPLETED", "VOIDED"]).optional(),
    channel: z.enum(["RETAIL", "WHOLESALE"]).optional(),
    customerId: optionalText(128),
    unpaid: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    q: optionalText(100),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    cursor: optionalText(400),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

/** Flattens a Zod error into a short list a client can show next to fields. */
export function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
