export type SalesSummaryDayDto = {
  date: string;
  retailSupposedRevenueKobo: string;
  wholesaleSupposedRevenueKobo: string;
  totalSupposedRevenueKobo: string;
  retailRevenueGottenKobo: string;
  wholesaleRevenueGottenKobo: string;
  totalRevenueGottenKobo: string;
  retailStandardRevenueKobo: string;
  wholesaleStandardRevenueKobo: string;
  totalStandardRevenueKobo: string;
  retailRevenueKobo: string;
  wholesaleRevenueKobo: string;
  totalRevenueKobo: string;
  retailCogsKobo: string;
  wholesaleCogsKobo: string;
  totalCogsKobo: string;
  retailGrossProfitKobo: string;
  wholesaleGrossProfitKobo: string;
  totalGrossProfitKobo: string;
  retailExpensesKobo: string;
  wholesaleExpensesKobo: string;
  totalExpensesKobo: string;
  retailNetProfitKobo: string;
  wholesaleNetProfitKobo: string;
  totalNetProfitKobo: string;
};

export type SalesSummaryTotalsDto = {
  retailSupposedRevenueKobo: string;
  wholesaleSupposedRevenueKobo: string;
  totalSupposedRevenueKobo: string;
  retailRevenueGottenKobo: string;
  wholesaleRevenueGottenKobo: string;
  totalRevenueGottenKobo: string;
  retailStandardRevenueKobo: string;
  wholesaleStandardRevenueKobo: string;
  totalStandardRevenueKobo: string;
  retailRevenueKobo: string;
  wholesaleRevenueKobo: string;
  totalRevenueKobo: string;
  retailCogsKobo: string;
  wholesaleCogsKobo: string;
  totalCogsKobo: string;
  retailGrossProfitKobo: string;
  wholesaleGrossProfitKobo: string;
  totalGrossProfitKobo: string;
  retailExpensesKobo: string;
  wholesaleExpensesKobo: string;
  totalExpensesKobo: string;
  retailNetProfitKobo: string;
  wholesaleNetProfitKobo: string;
  totalNetProfitKobo: string;
};

export type SalesSummaryDto = {
  days: SalesSummaryDayDto[];
  totals: SalesSummaryTotalsDto;
};

export interface ReportsApi {
  salesSummary(from: Date, to: Date): Promise<SalesSummaryDto>;
}
