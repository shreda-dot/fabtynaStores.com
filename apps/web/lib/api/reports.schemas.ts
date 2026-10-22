import { z } from "zod";
import { ApiError } from "./client";

/**
 * Runtime guards for the five report endpoints. A shape mismatch becomes one
 * clear "unexpected response" error instead of NaN or a blank card. Unknown
 * extra fields are ignored so additive API changes do not break the web.
 */

const koboString = z.string().regex(/^-?\d+$/, "Expected integer kobo string");
const lagosDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const channelSchema = z.enum(["RETAIL", "WHOLESALE"]);

const SUMMARY_METRICS = [
  "SupposedRevenue",
  "RevenueGotten",
  "StandardRevenue",
  "Revenue",
  "Cogs",
  "GrossProfit",
  "Expenses",
  "NetProfit",
] as const;

const summaryKoboShape = Object.fromEntries(
  (["retail", "wholesale", "total"] as const).flatMap((prefix) =>
    SUMMARY_METRICS.map((metric) => [`${prefix}${metric}Kobo`, koboString] as const),
  ),
);

const summaryTotalsSchema = z.object(summaryKoboShape);
const summaryDaySchema = z.object({ date: lagosDate, ...summaryKoboShape });

export const salesSummaryResponseSchema = z.object({
  days: z.array(summaryDaySchema),
  totals: summaryTotalsSchema,
  from: lagosDate,
  to: lagosDate,
  channel: channelSchema.nullable(),
});

const metricSchema = z.object({ value: koboString, yesterday: koboString });
const dashboardChannelSchema = z.object({
  supposedKobo: koboString,
  gottenKobo: koboString,
  debtKobo: koboString,
});

export const dashboardResponseSchema = z.object({
  date: lagosDate,
  metrics: z.object({
    netProfitKobo: metricSchema,
    revenueGottenKobo: metricSchema,
    expensesKobo: metricSchema,
    debtKobo: metricSchema,
  }),
  channels: z.object({
    RETAIL: dashboardChannelSchema,
    WHOLESALE: dashboardChannelSchema,
  }),
  stock: z.object({
    asOf: z.literal("now"),
    worthAtCostKobo: koboString,
    worthAtRetailKobo: koboString,
    worthAtWholesaleKobo: koboString,
  }),
});

export const productSalesResponseSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      productName: z.string(),
      unitsSold: z.string().regex(/^-?\d+(\.\d+)?$/, "Expected a decimal string"),
      billedRevenueKobo: koboString,
      cogsKobo: koboString,
      grossProfitKobo: koboString,
    }),
  ),
  from: lagosDate,
  to: lagosDate,
  channel: channelSchema.nullable(),
  revenueDefinition: z.string(),
});

const moneyFlowRowSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string(),
  accountType: z.enum(["CASH", "BANK", "POS"]),
  openingBalanceKobo: koboString,
  moneyInKobo: koboString,
  moneyOutKobo: koboString,
  netKobo: koboString,
  closingBalanceKobo: koboString,
  categories: z.array(
    z.object({
      key: z.string().min(1),
      moneyInKobo: koboString,
      moneyOutKobo: koboString,
    }),
  ),
});

export const moneyFlowResponseSchema = z.object({
  from: lagosDate,
  to: lagosDate,
  rows: z.array(moneyFlowRowSchema),
  totals: z.object({
    openingBalanceKobo: koboString,
    moneyInKobo: koboString,
    moneyOutKobo: koboString,
    netKobo: koboString,
    closingBalanceKobo: koboString,
  }),
  transfers: z.object({ moneyInKobo: koboString, moneyOutKobo: koboString }),
  sales: z.object({
    salesBilledKobo: koboString,
    cashReceivedFromSalesKobo: koboString,
    debtsFromRangeSalesKobo: koboString,
    debtsOwedNowKobo: koboString,
  }),
});

const scenarioSchema = z.object({
  scenario: z.enum(["EXPECTED", "BEST", "FLOOR"]),
  stockValueKobo: koboString,
  receivablesKobo: koboString,
  cashKobo: koboString,
  totalAssetsKobo: koboString,
  totalLiabilitiesKobo: koboString,
  netPositionKobo: koboString,
  canClearAll: z.boolean(),
  coverageBps: z.number().int().nullable(),
  stockOnlyCoverageBps: z.number().int().nullable(),
  stockOnlyNetKobo: koboString,
});

export const financialPositionResponseSchema = z.object({
  asOf: z.literal("now"),
  selectedScenario: z.enum(["EXPECTED", "BEST", "FLOOR"]),
  selected: scenarioSchema,
  scenarios: z.object({
    EXPECTED: scenarioSchema,
    BEST: scenarioSchema,
    FLOOR: scenarioSchema,
  }),
  liabilitiesBreakdown: z.object({
    payablesBySupplier: z.array(
      z.object({
        supplierId: z.string(),
        supplierName: z.string(),
        amountKobo: koboString,
      }),
    ),
    loansByLender: z.array(
      z.object({
        loanId: z.string(),
        lenderName: z.string(),
        amountKobo: koboString,
      }),
    ),
  }),
  obligations: z.array(
    z.object({
      kind: z.enum(["SUPPLIER_PURCHASE", "LOAN"]),
      id: z.string(),
      label: z.string(),
      balanceKobo: koboString,
      dueDate: lagosDate.nullable(),
      urgency: z.enum(["OVERDUE", "DUE_IN_7_DAYS", "LATER"]),
    }),
  ),
});

export type MoneyFlowResponse = z.infer<typeof moneyFlowResponseSchema>;
export type FinancialPositionResponse = z.infer<
  typeof financialPositionResponseSchema
>;

export const UNEXPECTED_RESPONSE_MESSAGE =
  "The server sent a response this app does not understand. Refresh and try again; if it keeps happening, contact support.";

export function parseReportResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const detail = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new ApiError("unknown", UNEXPECTED_RESPONSE_MESSAGE, {
    detail: `${label}: ${detail}`,
  });
}
