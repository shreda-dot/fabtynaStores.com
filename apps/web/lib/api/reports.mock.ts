import {
  getLagosBusinessDate,
  getLagosBusinessDayRange,
  salesSummary,
  type SalesSummaryResult,
} from "@fabtyna/shared";
import type { ReportsApi, SalesSummaryDto } from "./reports.api";
import { createNotConnectedError } from "./client";
import { readMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function toDto(
  result: SalesSummaryResult,
  range: { from: string; to: string },
): SalesSummaryDto {
  return {
    from: range.from,
    to: range.to,
    channel: null,
    days: result.days.map((day) => ({
      date: day.date,
      retailSupposedRevenueKobo: day.retailSupposedRevenueKobo.toString(),
      wholesaleSupposedRevenueKobo: day.wholesaleSupposedRevenueKobo.toString(),
      totalSupposedRevenueKobo: day.totalSupposedRevenueKobo.toString(),
      retailRevenueGottenKobo: day.retailRevenueGottenKobo.toString(),
      wholesaleRevenueGottenKobo: day.wholesaleRevenueGottenKobo.toString(),
      totalRevenueGottenKobo: day.totalRevenueGottenKobo.toString(),
      retailStandardRevenueKobo: day.retailStandardRevenueKobo.toString(),
      wholesaleStandardRevenueKobo: day.wholesaleStandardRevenueKobo.toString(),
      totalStandardRevenueKobo: day.totalStandardRevenueKobo.toString(),
      retailRevenueKobo: day.retailRevenueKobo.toString(),
      wholesaleRevenueKobo: day.wholesaleRevenueKobo.toString(),
      totalRevenueKobo: day.totalRevenueKobo.toString(),
      retailCogsKobo: day.retailCogsKobo.toString(),
      wholesaleCogsKobo: day.wholesaleCogsKobo.toString(),
      totalCogsKobo: day.totalCogsKobo.toString(),
      retailGrossProfitKobo: day.retailGrossProfitKobo.toString(),
      wholesaleGrossProfitKobo: day.wholesaleGrossProfitKobo.toString(),
      totalGrossProfitKobo: day.totalGrossProfitKobo.toString(),
      retailExpensesKobo: day.retailExpensesKobo.toString(),
      wholesaleExpensesKobo: day.wholesaleExpensesKobo.toString(),
      totalExpensesKobo: day.totalExpensesKobo.toString(),
      retailNetProfitKobo: day.retailNetProfitKobo.toString(),
      wholesaleNetProfitKobo: day.wholesaleNetProfitKobo.toString(),
      totalNetProfitKobo: day.totalNetProfitKobo.toString(),
    })),
    totals: {
      retailSupposedRevenueKobo: result.totals.retailSupposedRevenueKobo.toString(),
      wholesaleSupposedRevenueKobo: result.totals.wholesaleSupposedRevenueKobo.toString(),
      totalSupposedRevenueKobo: result.totals.totalSupposedRevenueKobo.toString(),
      retailRevenueGottenKobo: result.totals.retailRevenueGottenKobo.toString(),
      wholesaleRevenueGottenKobo: result.totals.wholesaleRevenueGottenKobo.toString(),
      totalRevenueGottenKobo: result.totals.totalRevenueGottenKobo.toString(),
      retailStandardRevenueKobo: result.totals.retailStandardRevenueKobo.toString(),
      wholesaleStandardRevenueKobo: result.totals.wholesaleStandardRevenueKobo.toString(),
      totalStandardRevenueKobo: result.totals.totalStandardRevenueKobo.toString(),
      retailRevenueKobo: result.totals.retailRevenueKobo.toString(),
      wholesaleRevenueKobo: result.totals.wholesaleRevenueKobo.toString(),
      totalRevenueKobo: result.totals.totalRevenueKobo.toString(),
      retailCogsKobo: result.totals.retailCogsKobo.toString(),
      wholesaleCogsKobo: result.totals.wholesaleCogsKobo.toString(),
      totalCogsKobo: result.totals.totalCogsKobo.toString(),
      retailGrossProfitKobo: result.totals.retailGrossProfitKobo.toString(),
      wholesaleGrossProfitKobo: result.totals.wholesaleGrossProfitKobo.toString(),
      totalGrossProfitKobo: result.totals.totalGrossProfitKobo.toString(),
      retailExpensesKobo: result.totals.retailExpensesKobo.toString(),
      wholesaleExpensesKobo: result.totals.wholesaleExpensesKobo.toString(),
      totalExpensesKobo: result.totals.totalExpensesKobo.toString(),
      retailNetProfitKobo: result.totals.retailNetProfitKobo.toString(),
      wholesaleNetProfitKobo: result.totals.wholesaleNetProfitKobo.toString(),
      totalNetProfitKobo: result.totals.totalNetProfitKobo.toString(),
    },
  };
}

export const reportsMockApi: ReportsApi = {
  async salesSummary(query) {
    await delay();
    const today = getLagosBusinessDate();
    const from = query.from ?? query.to ?? today;
    const to = query.to ?? from;
    const store = readMockStore();
    const result = salesSummary(
      getLagosBusinessDayRange(from).start,
      getLagosBusinessDayRange(to).end,
      store.sales,
      store.saleLines,
      store.products,
      store.expenses,
      store.salePayments,
      new Set(
        store.accountLedgerEntries
          .filter((entry) => entry.reversesEntryId !== null)
          .map((reversal) => store.accountLedgerEntries.find(
            (entry) => entry.id === reversal.reversesEntryId,
          )?.salePaymentId)
          .filter((paymentId): paymentId is string => paymentId !== null && paymentId !== undefined),
      ),
    );
    return toDto(result, { from, to });
  },

  // Demo data has no dashboard or product-sales endpoint; pages hide these in mock mode.
  async dashboard() {
    throw createNotConnectedError();
  },

  async productSales() {
    throw createNotConnectedError();
  },
};
