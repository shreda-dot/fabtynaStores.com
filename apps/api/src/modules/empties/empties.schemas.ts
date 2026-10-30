import { z } from "zod";
import { idSchema, isoDateTimeSchema, lagosDateStringSchema } from "@fabtyna/shared";
import { IDEMPOTENCY_KEY_PATTERN } from "../../lib/idempotency.js";

/**
 * Zod contracts for the empties endpoints.
 *
 * Empties are COUNTS, not money: `quantity` is a plain integer and is never
 * zero. `unitValueKobo` is a display-only money figure in the same integer-kobo
 * string form every other money field uses.
 */

export const emptiesIdParamsSchema = z.object({ id: idSchema }).strict();

export const emptiesIdempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    "Idempotency-Key must be 8-128 characters: letters, digits, '.', '_', ':' or '-'.",
  );

export const emptiesKindSchema = z.enum(["BOTTLE", "CRATE"]);

export const emptiesMovementTypeSchema = z.enum([
  "OPENING",
  "RECEIVED",
  "RETURNED_TO_OWNER",
  "ADJUSTMENT",
]);

const includeInactiveSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default(false);

const ownerNameSchema = z.string().trim().min(1).max(60);
const typeLabelSchema = z.string().trim().min(1).max(40);

/** `null` clears the display value; `undefined` leaves it untouched. */
const unitValueKoboSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Must be a nonnegative integer kobo string.")
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, "The value is too large.")
  .nullable();

// ---------- owners ----------
export const ownerListQuerySchema = z.object({ includeInactive: includeInactiveSchema }).strict();

export const createOwnerSchema = z.object({ name: ownerNameSchema }).strict();
export type CreateOwnerBody = z.infer<typeof createOwnerSchema>;
export const renameOwnerSchema = createOwnerSchema;
export type RenameOwnerBody = z.infer<typeof renameOwnerSchema>;

// ---------- types ----------
export const typeListQuerySchema = z
  .object({ includeInactive: includeInactiveSchema, ownerId: idSchema.optional() })
  .strict();
export type ListTypesQuery = z.infer<typeof typeListQuerySchema>;

export const createTypeSchema = z
  .object({
    ownerId: idSchema,
    kind: emptiesKindSchema,
    label: typeLabelSchema,
    unitValueKobo: unitValueKoboSchema.optional(),
  })
  .strict();
export type CreateTypeBody = z.infer<typeof createTypeSchema>;

export const patchTypeSchema = z
  .object({ label: typeLabelSchema.optional(), unitValueKobo: unitValueKoboSchema.optional() })
  .strict()
  .refine((body) => body.label !== undefined || body.unitValueKobo !== undefined, {
    message: "Provide a label or a unit value to change.",
  });
export type PatchTypeBody = z.infer<typeof patchTypeSchema>;

// ---------- balances ----------
export const balanceListQuerySchema = z.object({ includeInactive: includeInactiveSchema }).strict();
export type ListBalancesQuery = z.infer<typeof balanceListQuerySchema>;

// ---------- movements ----------
const movementQuantitySchema = z
  .number()
  .int()
  .safe()
  .min(-2_147_483_648)
  .max(2_147_483_647)
  .refine((value) => value !== 0, "Quantity must not be zero.");

export const createMovementSchema = z
  .object({
    typeId: idSchema,
    movementType: emptiesMovementTypeSchema,
    /**
     * Positive for OPENING / RECEIVED / RETURNED_TO_OWNER (the server applies
     * the direction). For ADJUSTMENT the sign is taken as given, so a negative
     * adjustment is a correction downwards.
     */
    quantity: movementQuantitySchema,
    note: z.string().trim().min(1).max(500).nullable().optional(),
    occurredAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine((body) => body.movementType === "ADJUSTMENT" || body.quantity > 0, {
    message: "Quantity must be a positive whole number for this movement type.",
    path: ["quantity"],
  })
  .refine(
    (body) => body.movementType !== "ADJUSTMENT" || (body.note ?? "").trim() !== "",
    { message: "A reason is required when adjusting the count.", path: ["note"] },
  );
export type CreateMovementBody = z.infer<typeof createMovementSchema>;

export const reverseMovementSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type ReverseMovementBody = z.infer<typeof reverseMovementSchema>;

export const listMovementsQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    typeId: idSchema.optional(),
    ownerId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
