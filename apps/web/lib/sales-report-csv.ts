import type { SalesSummaryDto } from "@/lib/api/reports.api";

function koboToDecimal(kobo: string): string {
  const value = BigInt(kobo);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function salesReportCsv(report: SalesSummaryDto): string {
  const header = [
    "Date", "Supposed revenue", "Gotten revenue", "COGS", "Gross profit", "Expenses",
    "Net profit", "Family support taken", "Net profit less family support",
  ];
  const salesDays = new Map(report.days.map((day) => [day.date, day]));
  const familyDays = new Map(report.familySupport.days.map((day) => [day.date, day]));
  const dates = [...new Set([...salesDays.keys(), ...familyDays.keys()])].sort().reverse();
  const rows = dates.map((date) => {
    const day = salesDays.get(date);
    const family = familyDays.get(date);
    return [
      date,
      koboToDecimal(day?.totalSupposedRevenueKobo ?? "0"),
      koboToDecimal(day?.totalRevenueGottenKobo ?? "0"),
      koboToDecimal(day?.totalCogsKobo ?? "0"),
      koboToDecimal(day?.totalGrossProfitKobo ?? "0"),
      koboToDecimal(day?.totalExpensesKobo ?? "0"),
      koboToDecimal(day?.totalNetProfitKobo ?? "0"),
      koboToDecimal(family?.familySupportTakenKobo ?? "0"),
      koboToDecimal(family?.netProfitLessFamilySupportKobo ?? "0"),
    ];
  });
  const t = report.totals;
  rows.push([
    "Total", koboToDecimal(t.totalSupposedRevenueKobo), koboToDecimal(t.totalRevenueGottenKobo),
    koboToDecimal(t.totalCogsKobo), koboToDecimal(t.totalGrossProfitKobo),
    koboToDecimal(t.totalExpensesKobo), koboToDecimal(t.totalNetProfitKobo),
    koboToDecimal(report.familySupport.familySupportTakenKobo),
    koboToDecimal(report.familySupport.netProfitLessFamilySupportKobo),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
