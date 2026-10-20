import { z } from "zod";
import {
  createPurchaseDtoSchema,
  idSchema,
  lagosDateStringSchema,
  recordPurchasePaymentDtoSchema,
} from "@fabtyna/shared";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../sales/sales.schemas.js";

// Same header and error-flattening helpers as sales: one version.
export { idempotencyKeySchema, zodIssues } from "../sales/sales.schemas.js";

export { createPurchaseDtoSchema };
export type CreatePurchaseDto = z.infer<typeof createPurchaseDtoSchema>;

export const purchaseIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

/** Body of POST /purchases/:id/payments: the shared DTO, but the account is required. */
export const recordPurchasePaymentBodySchema = recordPurchasePaymentDtoSchema
  .extend({ accountId: idSchema })
  .strict();
export type RecordPurchasePaymentBody = z.infer<typeof recordPurchasePaymentBodySchema>;

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const booleanFlag = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

/** Query string of GET /purchases. Everything is optional. */
export const listPurchasesQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    supplierId: optionalText(128),
    status: z.enum(["DRAFT", "RECEIVED", "VOIDED"]).optional(),
    unpaid: booleanFlag,
    overdue: booleanFlag,
    q: optionalText(100),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    cursor: optionalText(400),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
