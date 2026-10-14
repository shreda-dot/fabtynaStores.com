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
