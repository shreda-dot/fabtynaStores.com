import { z } from "zod";
import { idSchema, nonnegativeKoboStringSchema } from "@fabtyna/shared";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../sales/sales.schemas.js";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const searchText = z.string().trim().min(1).max(100).optional();

export const partyIdParamsSchema = z.object({ id: idSchema }).strict();

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["RETAIL", "WHOLESALE"]).default("RETAIL"),
  phone: optionalText(40),
  email: optionalText(254),
  address: optionalText(500),
  notes: optionalText(2000),
  creditLimitKobo: nonnegativeKoboStringSchema.default("0"),
}).strict();
export const patchCustomerSchema = createCustomerSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  "At least one field is required.",
);

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: optionalText(40),
  email: optionalText(254),
  address: optionalText(500),
  notes: optionalText(2000),
}).strict();
export const patchSupplierSchema = createSupplierSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  "At least one field is required.",
);

const pagination = {
  q: searchText,
  active: z.enum(["true", "false"]).transform((value) => value === "true").default(true),
  withBalance: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().trim().min(1).max(400).optional(),
};

export const listCustomersQuerySchema = z.object({
  ...pagination,
  type: z.enum(["RETAIL", "WHOLESALE"]).optional(),
}).strict();
export const listSuppliersQuerySchema = z.object(pagination).strict();
export const statementQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().trim().min(1).max(400).optional(),
}).strict().refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
  message: "'from' must not be after 'to'.",
  path: ["from"],
});

export const debtorsQuerySchema = z.object({
  q: searchText,
  minBalanceKobo: nonnegativeKoboStringSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().trim().min(1).max(400).optional(),
}).strict();

export const payablesQuerySchema = z.object({
  q: searchText,
  overdueOnly: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().trim().min(1).max(400).optional(),
}).strict();

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
export type PatchCustomerBody = z.infer<typeof patchCustomerSchema>;
export type CreateSupplierBody = z.infer<typeof createSupplierSchema>;
export type PatchSupplierBody = z.infer<typeof patchSupplierSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
export type StatementQuery = z.infer<typeof statementQuerySchema>;
export type DebtorsQuery = z.infer<typeof debtorsQuerySchema>;
export type PayablesQuery = z.infer<typeof payablesQuerySchema>;
