import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.ts";

export const customerTypeSchema = z.enum(["WHOLESALE", "RETAIL"]);

export const customerDtoSchema = z
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

export const createCustomerDtoSchema = z
  .object({
    name: z.string().trim().min(1),
    type: customerTypeSchema,
    creditLimitKobo: nonnegativeKoboStringSchema,
    phone: z.string().trim().nullable(),
    email: z.string().trim().nullable(),
    address: z.string().trim().nullable(),
    notes: z.string().trim().nullable(),
  })
  .strict();
