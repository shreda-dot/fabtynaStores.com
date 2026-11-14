import { describe, expect, it } from "vitest";
import type { SalesSummaryDto, SalesSummaryTotalsDto } from "@/lib/api/reports.api";
import { salesReportCsv } from "./sales-report-csv";

describe("sales report CSV", () => {
  it("preserves existing columns and includes drawing-only days and totals", () => {
    const totals = Object.fromEntries(
      ["retail", "wholesale", "total"].flatMap((prefix) =>
        ["SupposedRevenue", "RevenueGotten", "StandardRevenue", "Revenue", "Cogs", "GrossProfit", "Expenses", "NetProfit"]
          .map((metric) => [`${prefix}${metric}Kobo`, "0"]),
      ),
    ) as SalesSummaryTotalsDto;
    totals.totalNetProfitKobo = "12345";
    const report: SalesSummaryDto = {
      from: "2026-01-01", to: "2026-01-02", channel: null,
      totals,
      days: [{ date: "2026-01-01", ...totals }],
      familySupport: {
        netProfitKobo: "12345", familySupportTakenKobo: "500",
        netProfitLessFamilySupportKobo: "11845",
        days: [
          { date: "2026-01-01", familySupportTakenKobo: "0", netProfitLessFamilySupportKobo: "12345" },
          { date: "2026-01-02", familySupportTakenKobo: "500", netProfitLessFamilySupportKobo: "-500" },
        ],
      },
    };
    expect(salesReportCsv(report).split("\n")).toEqual([
      "Date,Supposed revenue,Gotten revenue,COGS,Gross profit,Expenses,Net profit,Family support taken,Net profit less family support",
      "2026-01-02,0.00,0.00,0.00,0.00,0.00,0.00,5.00,-5.00",
      "2026-01-01,0.00,0.00,0.00,0.00,0.00,123.45,0.00,123.45",
      "Total,0.00,0.00,0.00,0.00,0.00,123.45,5.00,118.45",
    ]);
  });
});
