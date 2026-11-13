// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { formatNaira } from "@fabtyna/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stockApi } from "@/lib/api";
import type { StockViewDto } from "@/lib/api/stock.api";
import WarehousePage from "./warehouse/page";
import RetailPage from "./retail/page";

vi.mock("@/lib/api", () => ({ stockApi: { listPage: vi.fn() } }));
afterEach(cleanup);

const row: StockViewDto = {
  productId: "bud", productName: "Budweiser", sku: "BUD", packName: "crate", unitsPerPack: 12, active: true,
  averageCostKobo: "92333", retailPriceKobo: "130000", wholesalePriceKobo: "1280000",
  totalUnits: 17, byLocation: [
    { location: "WAREHOUSE", quantityUnits: 12 }, { location: "RETAIL_SHELF", quantityUnits: 5 },
  ],
  worthAtCostKobo: "1569661", worthAtRetailKobo: "2210000", retailWorthKobo: "2210000",
  wholesaleWorthKobo: "1813333", reorderLevelUnits: 0, lowStock: false,
};
const totals = { units: "17", worthAtCostKobo: "1569661", worthAtRetailKobo: "2210000", worthAtWholesaleKobo: "1813333", includeInactiveProducts: true };

function show(page: React.ReactNode) {
  vi.mocked(stockApi.listPage).mockImplementation(async (options) => ({
    items: options?.active ? [row] : [], nextCursor: null, totals,
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{page}</QueryClientProvider>);
}

describe("department inventory pages", () => {
  it("shows warehouse-only sale, cost and balance figures", async () => {
    show(<WarehousePage />);
    const table = await screen.findByRole("table");
    const contents = within(table);
    expect(contents.getByText(formatNaira(1280000n))).toBeTruthy();
    expect(contents.getByText(formatNaira(1107996n))).toBeTruthy();
    expect(contents.getByText(formatNaira(172004n))).toBeTruthy();
    expect(screen.queryByText(formatNaira(1813333n))).toBeNull();
    expect(screen.queryByText(/all stock/i)).toBeNull();
  });

  it("shows only fridge quantities and fridge retail worth", async () => {
    show(<RetailPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText(formatNaira(650000n))).toBeTruthy();
    expect(screen.queryByText(formatNaira(2210000n))).toBeNull();
    expect(screen.getByText("Total units in fridge")).toBeTruthy();
    expect(screen.queryByText(/all stock|market/i)).toBeNull();
  });
});
