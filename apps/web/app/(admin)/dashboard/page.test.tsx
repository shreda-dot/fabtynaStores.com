// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { formatNaira } from "@fabtyna/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportsApi } from "@/lib/api";
import DashboardPage from "./page";

vi.mock("@/lib/api", () => ({
  isMockApiMode: false,
  stockApi: { listPage: vi.fn() },
  salesApi: { list: vi.fn() },
  reportsApi: { dashboard: vi.fn(), salesSummary: vi.fn() },
}));
afterEach(cleanup);

describe("Dashboard stock on hand", () => {
  it("labels unchanged all-stock figures and displays expected worth", async () => {
    const metric = { value: "0", yesterday: "0" };
    const channel = { supposedKobo: "0", gottenKobo: "0", debtKobo: "0" };
    vi.mocked(reportsApi.dashboard).mockResolvedValue({
      date: "2026-11-13", metrics: { netProfitKobo: metric, revenueGottenKobo: metric, expensesKobo: metric, debtKobo: metric },
      channels: { RETAIL: channel, WHOLESALE: channel },
      stock: { asOf: "now", worthAtCostKobo: "1569661", worthAtRetailKobo: "2210000", worthAtWholesaleKobo: "1813333", expectedWorthKobo: "1930000" },
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardPage /></QueryClientProvider>);
    const heading = await screen.findByRole("heading", { name: "Stock on hand" });
    const card = within(heading.closest("section")!);
    for (const [label, amount] of [
      ["All stock at cost", 1569661n], ["All stock if sold at retail price", 2210000n],
      ["All stock if sold at wholesale price", 1813333n],
    ] as const) {
      expect(card.getByText(label).nextElementSibling?.textContent).toBe(formatNaira(amount));
    }
    expect(card.getByText("Expected worth").closest("dt")?.nextElementSibling?.textContent).toBe(formatNaira(1930000n));
    expect(card.getByText(/Warehouse \+ fridge \+ market combined/i)).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Explain expected worth" }));
    const hint = card.getByRole("tooltip", { name: "Warehouse stock at wholesale price plus fridge and market stock at retail price." });
    expect(hint.textContent).toBe("Warehouse stock at wholesale price plus fridge and market stock at retail price.");
    expect(hint.className).toContain("bottom-full");
    expect(heading.closest("section")?.className).not.toContain("overflow-hidden");
  });
});
