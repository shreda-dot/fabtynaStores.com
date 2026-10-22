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

export type ReportChannel = "RETAIL" | "WHOLESALE";

export type SalesSummaryDto = {
  days: SalesSummaryDayDto[];
  totals: SalesSummaryTotalsDto;
  /** Effective Lagos range the server used. */
  from: string;
  to: string;
  channel: ReportChannel | null;
};

export type SalesSummaryQuery = {
  from?: string;
  to?: string;
  channel?: ReportChannel;
};

export type DashboardMetricDto = { value: string; yesterday: string };

export type DashboardChannelDto = {
  supposedKobo: string;
  gottenKobo: string;
  debtKobo: string;
};

export type DashboardDto = {
  date: string;
  metrics: {
    netProfitKobo: DashboardMetricDto;
    revenueGottenKobo: DashboardMetricDto;
    expensesKobo: DashboardMetricDto;
    debtKobo: DashboardMetricDto;
  };
  channels: { RETAIL: DashboardChannelDto; WHOLESALE: DashboardChannelDto };
  stock: {
    asOf: "now";
    worthAtCostKobo: string;
    worthAtRetailKobo: string;
    worthAtWholesaleKobo: string;
  };
};

export type ProductSalesQuery = {
  from?: string;
  to?: string;
  channel?: ReportChannel;
  limit?: number;
};

export type ProductSalesItemDto = {
  productId: string;
  productName: string;
  unitsSold: string;
  billedRevenueKobo: string;
  cogsKobo: string;
  grossProfitKobo: string;
};

export type ProductSalesDto = {
  items: ProductSalesItemDto[];
  from: string;
  to: string;
  channel: ReportChannel | null;
  revenueDefinition: string;
};

export interface ReportsApi {
  salesSummary(query: SalesSummaryQuery): Promise<SalesSummaryDto>;
  dashboard(date?: string): Promise<DashboardDto>;
  productSales(query: ProductSalesQuery): Promise<ProductSalesDto>;
}
