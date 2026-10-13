import { describe, expect, it } from "vitest";
import {
  assertStockWillRemainNonnegative,
  calculateStockUnits,
  calculateWeightedAverageCostKobo,
  createTransferLegPair,
  formatStockUnits,
  splitStockIntoPacks,
  validateAdjustmentLine,
} from "../domain/stock";

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
