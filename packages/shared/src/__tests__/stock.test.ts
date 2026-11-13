import { describe, expect, it } from "vitest";
import {
  assertStockWillRemainNonnegative,
  calculateStockUnits,
  calculateWeightedAverageCostKobo,
  createTransferLegPair,
  formatStockUnits,
  splitStockIntoPacks,
  stockWorthAtWholesale,
  stockWorthByChannel,
  stockValueKobo,
  expectedStockValueKobo,
  validateAdjustmentLine,
} from "../domain/stock.ts";

describe("stock levels from movements", () => {
  it("sums signed units across movements", () => {
    expect(
      calculateStockUnits([
        { quantityUnits: 48 },
        { quantityUnits: -3 },
        { quantityUnits: -8 },
      ]),
    ).toBe(37);
  });

  it("splits stock into whole packs and remaining units", () => {
    expect(splitStockIntoPacks(37, 24)).toEqual({ packs: 1, remainingUnits: 13 });
    expect(splitStockIntoPacks(0, 24)).toEqual({ packs: 0, remainingUnits: 0 });
  });

  it("formats stock as packs and units", () => {
    expect(formatStockUnits(53, 24, "crate")).toBe("2 crates, 5 units");
    expect(formatStockUnits(24, 24, "crate")).toBe("1 crate");
    expect(formatStockUnits(5, 24, "crate")).toBe("5 units");
    expect(formatStockUnits(1, 24, "crate")).toBe("1 unit");
  });

  it("values loose wholesale units pro rata and rounds down", () => {
    expect(
      stockWorthAtWholesale(
        [
          {
            id: "movement",
            productId: "product",
            location: "WAREHOUSE",
            type: "PURCHASE",
            quantityUnits: 5,
            unitCostKobo: 0n,
            purchaseLineId: null,
            saleLineId: null,
            transferLegId: null,
            adjustmentLineId: null,
            returnLineId: null,
            reversesEntryId: null,
            occurredAt: new Date(0),
            createdAt: new Date(0),
          },
        ],
        { id: "product", unitsPerPack: 3, wholesalePriceKobo: 100n },
      ),
    ).toBe(166n);
  });

  it("values loose warehouse units pro rata in wholesale channel stock value", () => {
    const movements = [{
      id: "movement",
      productId: "product",
      location: "WAREHOUSE" as const,
      type: "PURCHASE" as const,
      quantityUnits: 5,
      unitCostKobo: 0n,
      purchaseLineId: null,
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: new Date(0),
      createdAt: new Date(0),
    }];
    expect(stockWorthByChannel(movements, {
      id: "product",
      unitsPerPack: 3,
      retailPriceKobo: 0n,
      wholesalePriceKobo: 100n,
      saleChannel: "BOTH",
    })).toEqual({ retailKobo: 0n, wholesaleKobo: 166n, totalKobo: 166n });
  });
});

describe("scoped stock valuation", () => {
  const prices = {
    unitsPerPack: 12, averageCostKobo: 92333n,
    wholesalePriceKobo: 1280000n, retailPriceKobo: 130000n,
  };

  it("values Budweiser by department and preserves all-stock dashboard values", () => {
    const quantities = { WAREHOUSE: 12, RETAIL_SHELF: 5 };
    expect(stockValueKobo(quantities, prices, "WAREHOUSE", "WHOLESALE")).toBe(1280000n);
    expect(stockValueKobo(quantities, prices, "WAREHOUSE", "COST")).toBe(1107996n);
    expect(stockValueKobo(quantities, prices, "WAREHOUSE", "WHOLESALE") -
      stockValueKobo(quantities, prices, "WAREHOUSE", "COST")).toBe(172004n);
    expect(stockValueKobo(quantities, prices, "RETAIL_SHELF", "RETAIL")).toBe(650000n);
    expect(stockValueKobo(quantities, prices, "ALL", "COST")).toBe(1569661n);
    expect(stockValueKobo(quantities, prices, "ALL", "RETAIL")).toBe(2210000n);
    expect(stockValueKobo(quantities, prices, "ALL", "WHOLESALE")).toBe(1813333n);
    expect(expectedStockValueKobo(quantities, prices)).toBe(1930000n);
  });

  it("includes market, loose units and empty departments with per-product floor rounding", () => {
    const quantities = { WAREHOUSE: 5, RETAIL_SHELF: 0, MARKET: 2 };
    const p = { unitsPerPack: 3, averageCostKobo: 50n, wholesalePriceKobo: 100n, retailPriceKobo: 150n };
    expect(stockValueKobo(quantities, p, "WAREHOUSE", "WHOLESALE")).toBe(166n);
    expect(stockValueKobo(quantities, p, "RETAIL_SHELF", "RETAIL")).toBe(0n);
    expect(stockValueKobo(quantities, p, "ALL", "WHOLESALE")).toBe(233n);
    expect(expectedStockValueKobo(quantities, p)).toBe(466n);
  });

  it("preserves the previous all-stock formula over pack and loose-unit boundaries", () => {
    for (const unitsPerPack of [1, 3, 12, 24]) {
      for (let units = 0; units < 80; units++) {
        const p = { ...prices, unitsPerPack, wholesalePriceKobo: 101n };
        const quantities = { WAREHOUSE: units, RETAIL_SHELF: 2, MARKET: 3 };
        const total = BigInt(units + 5);
        const oldWholesale = (total / BigInt(unitsPerPack)) * p.wholesalePriceKobo +
          ((total % BigInt(unitsPerPack)) * p.wholesalePriceKobo) / BigInt(unitsPerPack);
        expect(stockValueKobo(quantities, p, "ALL", "WHOLESALE")).toBe(oldWholesale);
        expect(stockValueKobo(quantities, p, "ALL", "RETAIL")).toBe(total * p.retailPriceKobo);
        expect(stockValueKobo(quantities, p, "ALL", "COST")).toBe(total * p.averageCostKobo);
      }
    }
  });
});

describe("weighted-average cost", () => {
  it("averages existing and received stock", () => {
    // 10 units @ 100kobo each + 5 units for 750kobo total
    // total cost = 10*100 + 750 = 1750; total units = 15; avg = 116.67 -> 117
    expect(calculateWeightedAverageCostKobo(10n, 100n, 5n, 750n)).toBe(117n);
  });

  it("handles zero existing units", () => {
    // 0 existing + 5 units for 750kobo -> 750/5 = 150
    expect(calculateWeightedAverageCostKobo(0n, 100n, 5n, 750n)).toBe(150n);
  });

  it("rejects zero received units", () => {
    expect(() => calculateWeightedAverageCostKobo(10n, 100n, 0n, 750n)).toThrow(
      "Weighted-average cost inputs are outside their valid ranges.",
    );
  });

  it("rounds half up", () => {
    // 1 unit @ 1kobo + 1 unit for 4kobo -> total 5 / 2 = 2.5 -> 3
    expect(calculateWeightedAverageCostKobo(1n, 1n, 1n, 4n)).toBe(3n);
  });

  it("rejects negative existing stock", () => {
    expect(() => calculateWeightedAverageCostKobo(-1n, 100n, 5n, 750n)).toThrow();
  });

  it("rejects negative received units", () => {
    expect(() => calculateWeightedAverageCostKobo(10n, 100n, -5n, 750n)).toThrow();
  });
});

describe("nonnegative stock guard", () => {
  it("rejects a movement that would make stock negative", () => {
    expect(() => assertStockWillRemainNonnegative(4n, -5n)).toThrow(
      "Stock cannot be reduced below zero.",
    );
    expect(() => assertStockWillRemainNonnegative(4n, -4n)).not.toThrow();
  });

  it("rejects a zero movement", () => {
    expect(() => assertStockWillRemainNonnegative(4n, 0n)).toThrow();
  });
});

describe("adjustment validation", () => {
  it("rejects a zero adjustment quantity", () => {
    expect(() => validateAdjustmentLine(0)).toThrow();
    expect(() => validateAdjustmentLine(-5)).not.toThrow();
    expect(() => validateAdjustmentLine(5)).not.toThrow();
  });
});

describe("paired transfer legs", () => {
  it("creates IN and OUT legs for a transfer", () => {
    const pair = createTransferLegPair("WAREHOUSE", "RETAIL_SHELF");
    expect(pair.out).toEqual({ location: "WAREHOUSE", direction: "OUT" });
    expect(pair.in).toEqual({ location: "RETAIL_SHELF", direction: "IN" });
  });

  it("rejects a transfer between the same location", () => {
    expect(() => createTransferLegPair("WAREHOUSE", "WAREHOUSE")).toThrow();
  });
});
