import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  nonnegativeKoboStringSchema,
} from "./common.ts";
import { stockLocationSchema } from "./stock.ts";
import { unitSchema } from "./purchase.ts";
import { saleChannelSchema as productSaleChannelSchema } from "./product.ts";

export const saleStatusSchema = z.enum(["DRAFT", "COMPLETED", "VOIDED"]);

const saleChannelSchema = productSaleChannelSchema.refine(
  (value) => value !== "BOTH",
  "A sale must be either RETAIL or WHOLESALE, not BOTH.",
);

export const saleLineDtoSchema = z
  .object({
    id: idSchema,
    saleId: idSchema,
    productId: idSchema,
    unit: unitSchema,
    quantity: z.number().positive(),
    unitsPerPackSnapshot: z.number().int().positive(),
    quantityUnits: z.number().int().positive(),
    unitPriceKobo: nonnegativeKoboStringSchema,
    lineTotalKobo: nonnegativeKoboStringSchema,
  })
  .strict();

export const saleDtoSchema = z
  .object({
    id: idSchema,
    customerId: idSchema.nullable(),
    customerName: z.string().trim().nullable(),
    createdById: idSchema,
    channel: saleChannelSchema,
    status: saleStatusSchema,
    reference: z.string().nullable(),
    notes: z.string().nullable(),
    totalKobo: nonnegativeKoboStringSchema,
    paidKobo: nonnegativeKoboStringSchema,
    soldAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const createSaleLineDtoSchema = z
  .object({
    productId: idSchema,
    unit: unitSchema,
    quantity: z.number().positive(),
    unitPriceKobo: nonnegativeKoboStringSchema,
  })
  .strict();

export const createSaleDtoSchema = z
  .object({
    customerId: idSchema.nullable(),
    customerName: z.string().trim().nullable(),
    channel: saleChannelSchema,
    location: stockLocationSchema,
    soldAt: isoDateTimeSchema,
    notes: z.string().trim().nullable(),
    reference: z.string().trim().nullable(),
    paidKobo: nonnegativeKoboStringSchema,
    lines: z.array(createSaleLineDtoSchema).min(1),
  })
  .strict();

export const salePaymentDtoSchema = z
  .object({
    id: idSchema,
    saleId: idSchema,
    amountKobo: nonnegativeKoboStringSchema,
    paidAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
