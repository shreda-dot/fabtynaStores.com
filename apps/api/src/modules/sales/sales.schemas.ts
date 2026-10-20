import { z } from "zod";
import { createSaleDtoSchema } from "@fabtyna/shared";
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

/** Flattens a Zod error into a short list a client can show next to fields. */
export function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
