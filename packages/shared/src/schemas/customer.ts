import { z } from "zod";
import type { CustomerDto } from "../dtos.js";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.js";

export const customerTypeSchema = z.enum(["WHOLESALE", "RETAIL"]);

export const customerDtoSchema: z.ZodType<CustomerDto> = z
  .object({
    id: idSchema,
    name: z.string(),
    type: customerTypeSchema,
    creditLimitKobo: nonnegativeKoboStringSchema,
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
    deletedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
