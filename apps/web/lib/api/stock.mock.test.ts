// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { listAllStock } from "./stock.api";
import { stockMockApi } from "./stock.mock";
import { resetDemoData, transactMockStore } from "./mock-store";
import { allStockValues, departmentStock } from "../stock-valuation";

describe("mock stock valuation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDemoData();
  });

  it("uses the same all-location values as the real API and retains inactive stock", async () => {
    transactMockStore((store) => {
      const product = store.products[0];
      product.deletedAt = new Date();
      product.unitsPerPack = 12;
      product.averageCostKobo = 92333n;
      product.retailPriceKobo = 130000n;
      product.wholesalePriceKobo = 1280000n;
      for (const [location, units] of [["WAREHOUSE", 12], ["RETAIL_SHELF", 5], ["MARKET", 2]] as const) {
        store.stockMovements.push({
          id: `test-${location}`, productId: product.id, location, type: "RETURN", quantityUnits: units,
          unitCostKobo: 92333n, purchaseLineId: null, saleLineId: null, transferLegId: null,
          adjustmentLineId: null, returnLineId: `source-${location}`, reversesEntryId: null,
          occurredAt: new Date(), createdAt: new Date(),
        });
      }
    });
    const rows = await listAllStock(stockMockApi);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      active: false, totalUnits: 19, worthAtCostKobo: "1754327",
      retailWorthKobo: "2470000", wholesaleWorthKobo: "2026666",
    });
    expect(allStockValues(rows).expected).toBe(2190000n);
    expect(departmentStock(rows, "WAREHOUSE").totals.sell).toBe(1280000n);
    expect(departmentStock(rows, "RETAIL_SHELF").totals.sell).toBe(650000n);
    const activePage = await stockMockApi.listPage({ active: true });
    expect(activePage.items).toHaveLength(0);
    expect(activePage.totals).toMatchObject({
      units: "19", worthAtCostKobo: "1754327", worthAtRetailKobo: "2470000",
      worthAtWholesaleKobo: "2026666", includeInactiveProducts: true,
    });
  }, 30000);
});
