import { describe, expect, it } from "vitest";
import { formatEmptiesCount, overviewCountRows } from "./empties-overview";

describe("empties overview display mapping", () => {
  it("uses the API totals and location-specific counts without recomputing crates", () => {
    const mapped = overviewCountRows({
      ownerId: "brewery-1",
      ownerName: "Brewery One",
      emptyCrates: 10,
      emptyBottles: 3,
      fullCrates: 4,
      looseUnitsInWarehouse: 4,
      bottlesOnShelfAndMarket: 35,
      totalCrates: 14,
      emptyValueKobo: "50000",
      products: [],
    });

    expect(mapped).toEqual([
      { label: "Empty crates", value: 10 },
      { label: "Full crates (in the warehouse)", value: 4 },
      { label: "Loose bottles in the warehouse", value: 4 },
      { label: "Bottles on the shelf and market", value: 35 },
    ]);
  });

  it("formats whole counts without decimal places", () => {
    expect(formatEmptiesCount(1234)).toBe("1,234");
  });
});
