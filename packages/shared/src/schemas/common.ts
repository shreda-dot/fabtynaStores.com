import { z } from "zod";

export const idSchema = z.string().min(1);

export const isoDateTimeSchema = z.iso.datetime();

export const signedKoboStringSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*|-[1-9]\d*)(?![\s\S])/,
    "Must be an integer kobo string.",
  );

export const nonnegativeKoboStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?![\s\S])/, "Must be a nonnegative integer kobo string.");

export const positiveKoboStringSchema = z
  .string()
  .regex(/^[1-9]\d*(?![\s\S])/, "Must be a positive integer kobo string.");

export const nullableTextSchema = z.string().nullable();

/**
 * A Lagos business date (date only, no time). Stored as `YYYY-MM-DD` so it is
 * never shifted by timezone conversion — compare directly with
 * `getLagosBusinessDate()`.
 */
export const lagosDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD business date.");

export const paymentMethodSchema = z.enum(["CASH", "TRANSFER", "OTHER"]);
