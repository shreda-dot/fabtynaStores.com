import type { PrismaClient } from "../../../generated/prisma/client.js";
import { getLagosBusinessDate } from "@fabtyna/shared";
import {
  getDashboard,
  getFinancialPosition,
  getMoneyFlow,
  getProductSales,
  getSalesSummary,
} from "./reports.queries.js";
import type {
  FinancialPositionQuery,
  MoneyFlowQuery,
  ProductSalesQuery,
  SalesSummaryQuery,
} from "./reports.schemas.js";

export interface ReportsServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  maxDateRangeDays?: number;
}

export function createReportsService(options: ReportsServiceOptions) {
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  return {
    salesSummary: (query: SalesSummaryQuery) =>
      getSalesSummary(options.prisma, query, now(), maxDateRangeDays),
    dashboard: (date?: string) =>
      getDashboard(options.prisma, date ?? getLagosBusinessDate(now())),
    productSales: (query: ProductSalesQuery) =>
      getProductSales(options.prisma, query, now(), maxDateRangeDays),
    moneyFlow: (query: MoneyFlowQuery) =>
      getMoneyFlow(options.prisma, query, now(), maxDateRangeDays),
    financialPosition: (query: FinancialPositionQuery) =>
      getFinancialPosition(options.prisma, query, now()),
  };
}
