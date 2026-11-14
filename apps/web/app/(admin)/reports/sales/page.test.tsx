// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNaira } from "@fabtyna/shared";
import { reportsApi } from "@/lib/api";
import type { SalesSummaryDto, SalesSummaryTotalsDto } from "@/lib/api/reports.api";
import SalesReportPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  reportsApi: { salesSummary: vi.fn() },
}));
vi.mock("@/hooks/use-lagos-business-date", () => ({
  useLagosBusinessDate: () => "2026-11-14",
}));
afterEach(cleanup);

describe("Sales report Family Support", () => {
  it("shows a separate all-channel summary and the requested explanation", async () => {
    const totals = Object.fromEntries(
      ["retail", "wholesale", "total"].flatMap((prefix) =>
        ["SupposedRevenue", "RevenueGotten", "StandardRevenue", "Revenue", "Cogs", "GrossProfit", "Expenses", "NetProfit"]
          .map((metric) => [`${prefix}${metric}Kobo`, "0"]),
      ),
    ) as SalesSummaryTotalsDto;
    const report: SalesSummaryDto = {
      days: [], totals, from: "2026-11-14", to: "2026-11-14", channel: null,
      familySupport: {
        netProfitKobo: "10000", familySupportTakenKobo: "2500",
        netProfitLessFamilySupportKobo: "7500", days: [],
      },
    };
    vi.mocked(reportsApi.salesSummary).mockResolvedValue(report);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SalesReportPage /></QueryClientProvider>);
    const heading = await screen.findByRole("heading", { name: "Profit after Family Support" });
    const card = within(heading.closest("section")!);
    expect(card.getByText("Net profit (all channels)").nextElementSibling?.textContent).toBe(formatNaira(10000n));
    expect(card.getByText("Family Support taken").nextElementSibling?.textContent).toBe(formatNaira(2500n));
    expect(card.getByText("Net profit less Family Support").nextElementSibling?.textContent).toBe(formatNaira(7500n));
    fireEvent.click(card.getByRole("button", { name: "About Family Support" }));
    expect(card.getByRole("tooltip").textContent).toBe("Money taken out for family. It does not reduce business profit; this line only shows what is left after it.");
  });
});
