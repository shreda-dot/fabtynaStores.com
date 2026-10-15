import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  positiveKoboStringSchema,
} from "./common.ts";
import { saleChannelSchema } from "./product.ts";

export const expenseCategorySchema = z.enum([
  "RENT",
  "UTILITY",
  "SALARY",
  "TRANSPORT",
  "MAINTENANCE",
  "SUPPLIES",
  "MARKETING",
  "OTHER",
]);

export const expenseDtoSchema = z
  .object({
    id: idSchema,
    channel: saleChannelSchema,
    category: expenseCategorySchema,
    description: z.string().trim().min(1),
    amountKobo: positiveKoboStringSchema,
    expenseDate: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const createExpenseDtoSchema = z
  .object({
    channel: saleChannelSchema,
    category: expenseCategorySchema,
    description: z.string().trim().min(1),
    amountKobo: positiveKoboStringSchema,
    expenseDate: isoDateTimeSchema,
  })
  .strict();
