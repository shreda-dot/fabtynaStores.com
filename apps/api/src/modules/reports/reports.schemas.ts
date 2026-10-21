import { z } from "zod";
import { idSchema, lagosDateStringSchema } from "@fabtyna/shared";

const range = {
  from: lagosDateStringSchema.optional(),
  to: lagosDateStringSchema.optional(),
};

export const salesSummaryQuerySchema = z.object({
  ...range,
  channel: z.enum(["RETAIL", "WHOLESALE"]).optional(),
}).strict();

export const dashboardQuerySchema = z.object({
  date: lagosDateStringSchema.optional(),
}).strict();

export const productSalesQuerySchema = z.object({
  ...range,
  channel: z.enum(["RETAIL", "WHOLESALE"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const basisPoints = z.coerce.number().int().min(0).max(10000);
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const financialPositionQuerySchema = z.object({
  scenario: z.enum(["EXPECTED", "BEST", "FLOOR"]).default("EXPECTED"),
  stockDiscountBps: basisPoints.optional(),
  receivablesCollectibleBps: basisPoints.optional(),
  includeReceivables: booleanQuery.optional(),
  includeCash: booleanQuery.optional(),
}).strict();

export const moneyFlowQuerySchema = z.object({
  ...range,
  accountId: idSchema.optional(),
}).strict();

export type SalesSummaryQuery = z.infer<typeof salesSummaryQuerySchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type ProductSalesQuery = z.infer<typeof productSalesQuerySchema>;
export type FinancialPositionQuery = z.infer<typeof financialPositionQuerySchema>;
export type MoneyFlowQuery = z.infer<typeof moneyFlowQuerySchema>;
