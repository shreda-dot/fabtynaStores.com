import { z } from "zod";
import {
  addLoanChargeDtoSchema,
  createLoanDtoSchema,
  idSchema,
  lagosDateStringSchema,
  recordLoanRepaymentDtoSchema,
} from "@fabtyna/shared";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../sales/sales.schemas.js";

export { idempotencyKeySchema, zodIssues } from "../sales/sales.schemas.js";
export { createLoanDtoSchema, addLoanChargeDtoSchema, recordLoanRepaymentDtoSchema };

export type CreateLoanDto = z.infer<typeof createLoanDtoSchema>;
export type AddLoanChargeDto = z.infer<typeof addLoanChargeDtoSchema>;
export type RecordLoanRepaymentDto = z.infer<typeof recordLoanRepaymentDtoSchema>;

export const loanIdParamsSchema = z.object({ id: idSchema }).strict();

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const listLoansQuerySchema = z
  .object({
    status: z.enum(["ACTIVE", "PAID", "OVERDUE"]).optional(),
    q: optionalText(100),
    dueBefore: lagosDateStringSchema.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    cursor: optionalText(400),
  })
  .strict();
export type ListLoansQuery = z.infer<typeof listLoansQuerySchema>;
