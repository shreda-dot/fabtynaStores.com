import type {
  AccountingPositionOptionsDto,
  FinancialPositionResult,
  FinancialPositionScenario,
  FinancialPositionScenarioResult,
} from "@fabtyna/shared";
import type { MoneyFlowReportDto } from "./accounting.api";
import { requestJson } from "./client";
import type {
  DashboardDto,
  ProductSalesDto,
  ProductSalesQuery,
  ReportsApi,
  SalesSummaryDto,
  SalesSummaryQuery,
} from "./reports.api";
import {
  dashboardResponseSchema,
  financialPositionResponseSchema,
  moneyFlowResponseSchema,
  parseReportResponse,
  productSalesResponseSchema,
  salesSummaryResponseSchema,
  type FinancialPositionResponse,
  type MoneyFlowResponse,
} from "./reports.schemas";

type QueryValue = string | number | boolean | undefined;

/**
 * The API validates queries with `.strict()`, so unset values are omitted
 * entirely. Booleans go out as "true"/"false", integers as plain digits.
 */
export function buildReportQuery(values: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        throw new RangeError(`Query value '${name}' must be an integer.`);
      }
      params.set(name, String(value));
    } else if (typeof value === "boolean") {
      params.set(name, value ? "true" : "false");
    } else {
      params.set(name, value);
    }
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export const reportPaths = {
  salesSummary: (query: SalesSummaryQuery) =>
    `/reports/sales-summary${buildReportQuery({
      from: query.from,
      to: query.to,
      channel: query.channel,
    })}`,
  dashboard: (date?: string) =>
    `/reports/dashboard${buildReportQuery({ date })}`,
  productSales: (query: ProductSalesQuery) =>
    `/reports/product-sales${buildReportQuery({
      from: query.from,
      to: query.to,
      channel: query.channel,
      limit: query.limit,
    })}`,
  moneyFlow: (from?: string, to?: string, accountId?: string) =>
    `/reports/money-flow${buildReportQuery({ from, to, accountId })}`,
  financialPosition: (
    options: AccountingPositionOptionsDto = {},
    scenario?: FinancialPositionScenario,
  ) =>
    `/reports/financial-position${buildReportQuery({
      scenario,
      stockDiscountBps: options.stockDiscountBps,
      receivablesCollectibleBps: options.receivablesCollectibleBps,
      includeReceivables: options.includeReceivables,
      includeCash: options.includeCash,
    })}`,
};

/** API names -> the money-flow DTO the accounting screens already use. */
export function mapMoneyFlow(response: MoneyFlowResponse): MoneyFlowReportDto {
  return {
    from: response.from,
    to: response.to,
    totalsExcludeTransfers: true,
    // The API key is an entry type or "EXPENSE:<code>"; flowCategoryLabel handles both.
    rows: response.rows as MoneyFlowReportDto["rows"],
    totals: response.totals,
    transfers: response.transfers,
    sales: {
      billedKobo: response.sales.salesBilledKobo,
      customerMoneyReceivedKobo: response.sales.cashReceivedFromSalesKobo,
      debtOutstandingKobo: response.sales.debtsFromRangeSalesKobo,
      debtsOwedNowKobo: response.sales.debtsOwedNowKobo,
    },
  };
}

function toScenarioResult(
  scenario: FinancialPositionResponse["selected"],
): FinancialPositionScenarioResult {
  return {
    scenario: scenario.scenario,
    stockValueKobo: BigInt(scenario.stockValueKobo),
    receivablesKobo: BigInt(scenario.receivablesKobo),
    cashKobo: BigInt(scenario.cashKobo),
    totalAssetsKobo: BigInt(scenario.totalAssetsKobo),
    totalLiabilitiesKobo: BigInt(scenario.totalLiabilitiesKobo),
    netPositionKobo: BigInt(scenario.netPositionKobo),
    canClearAll: scenario.canClearAll,
    coverageBps: scenario.coverageBps,
    stockOnlyCoverageBps: scenario.stockOnlyCoverageBps,
    stockOnlyNetKobo: BigInt(scenario.stockOnlyNetKobo),
  };
}

/** Kobo strings become bigint only for display arithmetic; the server did the maths. */
export function mapFinancialPosition(
  response: FinancialPositionResponse,
): FinancialPositionResult {
  return {
    scenarios: {
      EXPECTED: toScenarioResult(response.scenarios.EXPECTED),
      BEST: toScenarioResult(response.scenarios.BEST),
      FLOOR: toScenarioResult(response.scenarios.FLOOR),
    },
    liabilitiesBreakdown: {
      payablesBySupplier: response.liabilitiesBreakdown.payablesBySupplier.map(
        (line) => ({ ...line, amountKobo: BigInt(line.amountKobo) }),
      ),
      loansByLender: response.liabilitiesBreakdown.loansByLender.map(
        (line) => ({ ...line, amountKobo: BigInt(line.amountKobo) }),
      ),
    },
    obligations: response.obligations.map((obligation) => ({
      ...obligation,
      balanceKobo: BigInt(obligation.balanceKobo),
    })),
  };
}

export async function fetchMoneyFlow(
  from: string,
  to: string,
  accountId?: string,
): Promise<MoneyFlowReportDto> {
  const data = await requestJson<unknown>(
    reportPaths.moneyFlow(from, to, accountId),
  );
  return mapMoneyFlow(
    parseReportResponse(moneyFlowResponseSchema, data, "money-flow"),
  );
}

export async function fetchFinancialPosition(
  options?: AccountingPositionOptionsDto,
  scenario?: FinancialPositionScenario,
): Promise<FinancialPositionResult> {
  const data = await requestJson<unknown>(
    reportPaths.financialPosition(options, scenario),
  );
  return mapFinancialPosition(
    parseReportResponse(
      financialPositionResponseSchema,
      data,
      "financial-position",
    ),
  );
}

export const reportsRealApi: ReportsApi = {
  async salesSummary(query): Promise<SalesSummaryDto> {
    const data = await requestJson<unknown>(reportPaths.salesSummary(query));
    return parseReportResponse(
      salesSummaryResponseSchema,
      data,
      "sales-summary",
    ) as SalesSummaryDto;
  },

  async dashboard(date): Promise<DashboardDto> {
    const data = await requestJson<unknown>(reportPaths.dashboard(date));
    return parseReportResponse(dashboardResponseSchema, data, "dashboard");
  },

  async productSales(query): Promise<ProductSalesDto> {
    const data = await requestJson<unknown>(reportPaths.productSales(query));
    return parseReportResponse(
      productSalesResponseSchema,
      data,
      "product-sales",
    );
  },
};
