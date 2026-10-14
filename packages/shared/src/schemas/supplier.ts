import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.ts";

export const supplierDtoSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
    deletedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const createSupplierDtoSchema = z
  .object({
    name: z.string().trim().min(1),
    phone: z.string().nullable(),
    email: z.string().email().nullable(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .strict();
