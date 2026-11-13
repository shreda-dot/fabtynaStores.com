import { describe, expect, it, vi } from "vitest";
import { listAllStock, type StockApi, type StockViewDto } from "./api/stock.api";
import { allStockValues, departmentStock } from "./stock-valuation";

function product(id: string, warehouse: number, fridge: number, market = 0, active = true): StockViewDto {
  return {
    productId: id, productName: id, sku: null, packName: "crate", unitsPerPack: 12, active,
    averageCostKobo: "92333", wholesalePriceKobo: "1280000", retailPriceKobo: "130000",
    totalUnits: warehouse + fridge + market,
    byLocation: [
      { location: "WAREHOUSE", quantityUnits: warehouse },
      { location: "RETAIL_SHELF", quantityUnits: fridge },
      { location: "MARKET", quantityUnits: market },
    ],
    worthAtCostKobo: "0", worthAtRetailKobo: "0", retailWorthKobo: "0",
    wholesaleWorthKobo: "0", reorderLevelUnits: 0, lowStock: false,
  };
}

describe("department valuation", () => {
  it("uses only the selected units and sums the displayed rows, including inactive stock", () => {
    const data = [product("Budweiser", 12, 5), product("inactive", 1, 0, 0, false)];
    const warehouse = departmentStock(data, "WAREHOUSE");
    const fridge = departmentStock(data, "RETAIL_SHELF");
    expect(warehouse.items[0]).toMatchObject({ units: 12, cost: 1107996n, sell: 1280000n, balance: 172004n });
    expect(warehouse.items[1].row.active).toBe(false);
    expect(warehouse.totals.sell).toBe(warehouse.items[0].sell + warehouse.items[1].sell);
    expect(warehouse.totals.cost).toBe(warehouse.items[0].cost + warehouse.items[1].cost);
    expect(fridge.items).toHaveLength(1);
    expect(fridge.totals).toMatchObject({ units: 5, sell: 650000n });
  });

  it("includes market at retail in expected and all-stock totals", () => {
    expect(allStockValues([product("Budweiser", 12, 5, 2)])).toEqual({
      cost: 1754327n, retail: 2470000n, wholesale: 2026666n, expected: 2190000n,
    });
  });
});

describe("complete stock loading", () => {
  it("loads every page and inactive products rather than stopping at 50", async () => {
    const active = Array.from({ length: 51 }, (_, index) => product(`p${index}`, 1, 0));
    const inactive = product("inactive", 1, 0, 0, false);
    const totals = { units: "0", worthAtCostKobo: "0", worthAtRetailKobo: "0", worthAtWholesaleKobo: "0", includeInactiveProducts: true };
    const api: StockApi = {
      list: vi.fn(),
      lowStock: vi.fn(),
      movements: vi.fn(),
      listPage: vi.fn(async (options) => {
        if (!options?.active) return { items: [inactive], nextCursor: null, totals };
        if (!options.cursor) return { items: active.slice(0, 50), nextCursor: "second", totals };
        return { items: active.slice(50), nextCursor: null, totals };
      }),
    };
    const rows = await listAllStock(api);
    expect(rows).toHaveLength(52);
    expect(departmentStock(rows, "WAREHOUSE").totals.units).toBe(52);
    expect(allStockValues(rows).cost).toBe(52n * 92333n);
    expect(api.listPage).toHaveBeenCalledTimes(3);
  });
});
