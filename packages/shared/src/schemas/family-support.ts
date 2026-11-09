import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  positiveKoboStringSchema,
} from "./common.ts";

export const drawingPurposeSchema = z.enum([
  "SCHOOL_FEES",
  "SCHOOL_NEEDS",
  "MEDICAL",
  "TRANSPORT",
  "FEEDING",
  "HOUSEHOLD",
  "PERSONAL",
  "OTHER",
]);

export type DrawingPurpose = z.infer<typeof drawingPurposeSchema>;

export const familyMemberInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().min(1).max(120),
  })
  .strict();

export const createDrawingSchema = z
  .object({
    beneficiaryId: idSchema,
    purpose: drawingPurposeSchema,
    accountId: idSchema,
    amountKobo: positiveKoboStringSchema,
    occurredAt: isoDateTimeSchema,
    note: z.string().trim().max(500).nullable(),
  })
  .strict();

export type CreateDrawingInput = z.infer<typeof createDrawingSchema>;
