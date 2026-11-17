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
export const emptiesProductIdParamsSchema = z.object({ productId: idSchema }).strict();

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

export const emptiesCustomerMovementTypeSchema = z.enum([
  "TAKEN",
  "RETURNED",
  "KEPT",
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
    capacity: z.union([z.literal(12), z.literal(20), z.literal(24)]).nullable().optional(),
    unitValueKobo: unitValueKoboSchema.optional(),
  })
  .strict()
  .refine((body) => body.capacity == null || body.kind === "BOTTLE", {
    message: "Only bottle types can have a crate capacity.",
    path: ["capacity"],
  });
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

// ---------- product ownership ----------
export const productOwnerListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    assigned: z.enum(["all", "assigned", "unassigned"]).default("all"),
    cursor: z.string().trim().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ProductOwnerListQuery = z.infer<typeof productOwnerListQuerySchema>;

export const assignProductOwnerSchema = z.object({ ownerId: idSchema.nullable() }).strict();
export type AssignProductOwnerBody = z.infer<typeof assignProductOwnerSchema>;

const productPackagingRowSchema = z
  .object({
    typeId: idSchema,
    kind: emptiesKindSchema,
    retailQuantityPerUnit: z.number().int().safe().min(0).max(2_147_483_647),
    wholesaleQuantityPerPack: z.number().int().safe().min(0).max(2_147_483_647),
  })
  .strict()
  .refine(
    (row) => row.retailQuantityPerUnit > 0 || row.wholesaleQuantityPerPack > 0,
    "At least one sale conversion must be greater than zero.",
  );

export const assignProductPackagingSchema = z
  .object({
    mappings: z.array(productPackagingRowSchema).max(2),
  })
  .strict()
  .refine(
    (body) => new Set(body.mappings.map((row) => row.kind)).size === body.mappings.length,
    "A product can map to at most one empties type of each kind.",
  );
export type AssignProductPackagingBody = z.infer<typeof assignProductPackagingSchema>;

const purchasePackagingRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CRATE"),
    typeId: idSchema,
    countPerPack: z.number().int().safe().min(1).max(2_147_483_647),
  }).strict(),
  z.object({
    kind: z.literal("BOTTLE"),
    typeId: idSchema,
    countPerUnit: z.number().int().safe().min(1).max(2_147_483_647),
    cratesPerPack: z.number().int().safe().min(1).max(2_147_483_647).nullable().optional(),
  }).strict(),
]);

export const purchaseEmptiesSetupSchema = z.object({
  classification: z.enum(["RETURNABLE", "NON_RETURNABLE"]),
  mappings: z.array(purchasePackagingRowSchema).max(2),
}).strict()
  .refine((body) => new Set(body.mappings.map((row) => row.kind)).size === body.mappings.length, {
    message: "Choose at most one type of each container kind.",
    path: ["mappings"],
  })
  .refine((body) => body.classification === "RETURNABLE" || body.mappings.length === 0, {
    message: "Non-returnable products cannot have returnable container types.",
    path: ["mappings"],
  });
export type PurchaseEmptiesSetupBody = z.infer<typeof purchaseEmptiesSetupSchema>;

export const purchaseEmptiesSetupListSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type PurchaseEmptiesSetupListQuery = z.infer<typeof purchaseEmptiesSetupListSchema>;

export const openingSupplierEmptiesDebtSchema = z.object({
  supplierId: idSchema,
  typeId: idSchema,
  quantity: z.number().int().safe().min(1).max(2_147_483_647),
  note: z.string().trim().min(1).max(500),
}).strict();
export type OpeningSupplierEmptiesDebtBody = z.infer<typeof openingSupplierEmptiesDebtSchema>;

export const supplierEmptiesDebtListSchema = z.object({
  supplierId: idSchema.optional(),
  typeId: idSchema.optional(),
  includeSettled: includeInactiveSchema,
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type SupplierEmptiesDebtListQuery = z.infer<typeof supplierEmptiesDebtListSchema>;

export const supplierEmptiesSettlementListSchema = z.object({
  supplierId: idSchema.optional(),
  typeId: idSchema.optional(),
  obligationId: idSchema.optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type SupplierEmptiesSettlementListQuery = z.infer<typeof supplierEmptiesSettlementListSchema>;

export const settleSupplierEmptiesDebtSchema = z.object({
  supplierId: idSchema,
  typeId: idSchema,
  quantity: z.number().int().safe().min(1).max(2_147_483_647),
  allocations: z.array(z.object({
    obligationId: idSchema,
    quantity: z.number().int().safe().min(1).max(2_147_483_647),
  }).strict()).min(1).max(200).optional(),
  note: z.string().trim().min(1).max(500).optional(),
}).strict()
  .refine((body) => body.allocations === undefined
    || new Set(body.allocations.map((item) => item.obligationId)).size === body.allocations.length, {
    message: "Each debt can only be selected once.", path: ["allocations"],
  })
  .refine((body) => body.allocations === undefined
    || body.allocations.reduce((sum, item) => sum + item.quantity, 0) === body.quantity, {
    message: "Allocated amounts must add up to the return quantity.", path: ["allocations"],
  });
export type SettleSupplierEmptiesDebtBody = z.infer<typeof settleSupplierEmptiesDebtSchema>;

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

export const sizeClassRecountSchema = z.object({
  counts: z.array(z.object({
    typeId: idSchema,
    emptyCrates: z.number().int().safe().min(0).max(2_147_483_647),
    looseBottles: z.number().int().safe().min(0).max(2_147_483_647),
  }).strict()).min(1).max(500)
    .refine((rows) => new Set(rows.map((row) => row.typeId)).size === rows.length, {
      message: "Each size class can only be counted once.",
    }),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type SizeClassRecountBody = z.infer<typeof sizeClassRecountSchema>;

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

// ---------- customer movements ----------
const customerQuantitySchema = z
  .number()
  .int()
  .safe()
  .min(-2_147_483_648)
  .max(2_147_483_647)
  .refine((value) => value !== 0, "Quantity must not be zero.");

export const createCustomerMovementSchema = z
  .object({
    customerId: idSchema,
    typeId: idSchema,
    movementType: emptiesCustomerMovementTypeSchema,
    quantity: customerQuantitySchema,
    note: z.string().trim().min(1).max(500).nullable().optional(),
    occurredAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (body) => body.movementType === "ADJUSTMENT" || body.quantity > 0,
    {
      message: "Quantity must be a positive whole number for this movement type.",
      path: ["quantity"],
    },
  )
  .refine(
    (body) =>
      (body.movementType !== "KEPT" && body.movementType !== "ADJUSTMENT")
      || (body.note ?? "").trim() !== "",
    { message: "A note is required for this movement type.", path: ["note"] },
  );
export type CreateCustomerMovementBody = z.infer<typeof createCustomerMovementSchema>;

export const listCustomerBalancesQuerySchema = z
  .object({
    customerId: idSchema.optional(),
    ownerId: idSchema.optional(),
    typeId: idSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    onlyOwing: z.enum(["true", "false"]).transform((value) => value === "true").default(true),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict();
export type ListCustomerBalancesQuery = z.infer<typeof listCustomerBalancesQuerySchema>;

export const listCustomerMovementsQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    customerId: idSchema.optional(),
    typeId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListCustomerMovementsQuery = z.infer<typeof listCustomerMovementsQuerySchema>;

export const reverseCustomerMovementSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type ReverseCustomerMovementBody = z.infer<typeof reverseCustomerMovementSchema>;

// ---------- crate deposits ----------
const depositAmountKoboSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Must be a positive whole-kobo amount.")
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, "The amount is too large.");

export const emptiesDepositMovementTypeSchema = z.enum(["RECEIVED", "REFUNDED", "FORFEITED"]);

/**
 * RECEIVED and REFUNDED move money in and out of the holding account.
 * FORFEITED moves it to `toAccountId` and also reduces the crates the customer
 * owes by `quantity` of `typeId`.
 */
export const createDepositSchema = z
  .object({
    customerId: idSchema,
    movementType: emptiesDepositMovementTypeSchema,
    amountKobo: depositAmountKoboSchema,
    note: z.string().trim().min(1).max(500).nullable().optional(),
    occurredAt: isoDateTimeSchema.optional(),
    typeId: idSchema.optional(),
    quantity: z.number().int().safe().min(1).max(2_147_483_647).optional(),
    toAccountId: idSchema.optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.movementType === "FORFEITED"
      || (body.typeId === undefined && body.quantity === undefined && body.toAccountId === undefined),
    {
      message: "Crates and a destination account are only used when a deposit is forfeited.",
      path: ["movementType"],
    },
  )
  .refine(
    (body) =>
      body.movementType !== "FORFEITED"
      || (body.typeId !== undefined && body.quantity !== undefined && body.toAccountId !== undefined),
    {
      message: "A forfeit needs the crate type, the number of crates and the account that receives the money.",
      path: ["typeId"],
    },
  )
  .refine((body) => body.movementType !== "FORFEITED" || (body.note ?? "").trim() !== "", {
    message: "A note is required when a deposit is forfeited.",
    path: ["note"],
  });
export type CreateDepositBody = z.infer<typeof createDepositSchema>;

export const listDepositBalancesQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    onlyHolding: z.enum(["true", "false"]).transform((value) => value === "true").default(true),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict();
export type ListDepositBalancesQuery = z.infer<typeof listDepositBalancesQuerySchema>;

export const listDepositsQuerySchema = z
  .object({
    from: lagosDateStringSchema.optional(),
    to: lagosDateStringSchema.optional(),
    customerId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "'from' must not be after 'to'.",
    path: ["from"],
  });
export type ListDepositsQuery = z.infer<typeof listDepositsQuerySchema>;

export const reverseDepositSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type ReverseDepositBody = z.infer<typeof reverseDepositSchema>;
