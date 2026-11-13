import {
  expectedStockValueKobo,
  stockValueKobo,
  type StockValueQuantities,
} from "@fabtyna/shared";
import type { StockViewDto } from "./api/stock.api";

function inputs(row: StockViewDto) {
  const quantities: StockValueQuantities = {
    WAREHOUSE: row.byLocation.find((item) => item.location === "WAREHOUSE")?.quantityUnits ?? 0,
    RETAIL_SHELF: row.byLocation.find((item) => item.location === "RETAIL_SHELF")?.quantityUnits ?? 0,
    MARKET: row.byLocation.find((item) => item.location === "MARKET")?.quantityUnits ?? 0,
  };
  const prices = {
    unitsPerPack: row.unitsPerPack,
    averageCostKobo: BigInt(row.averageCostKobo),
    retailPriceKobo: BigInt(row.retailPriceKobo),
    wholesalePriceKobo: BigInt(row.wholesalePriceKobo),
  };
  return { quantities, prices };
}

export function departmentStock(rows: readonly StockViewDto[], scope: "WAREHOUSE" | "RETAIL_SHELF") {
  const items = rows.flatMap((row) => {
    const { quantities, prices } = inputs(row);
    const units = quantities[scope] ?? 0;
    if (units <= 0) return [];
    const cost = stockValueKobo(quantities, prices, scope, "COST");
    const sell = stockValueKobo(quantities, prices, scope, scope === "WAREHOUSE" ? "WHOLESALE" : "RETAIL");
    return [{ row, units, cost, sell, balance: sell - cost }];
  });
  const totals = items.reduce((result, item) => ({
    units: result.units + item.units,
    cost: result.cost + item.cost,
    sell: result.sell + item.sell,
    balance: result.balance + item.balance,
  }), { units: 0, cost: 0n, sell: 0n, balance: 0n });
  return { items, totals };
}

export function allStockValues(rows: readonly StockViewDto[]) {
  return rows.reduce((result, row) => {
    const { quantities, prices } = inputs(row);
    result.cost += stockValueKobo(quantities, prices, "ALL", "COST");
    result.retail += stockValueKobo(quantities, prices, "ALL", "RETAIL");
    result.wholesale += stockValueKobo(quantities, prices, "ALL", "WHOLESALE");
    result.expected += expectedStockValueKobo(quantities, prices);
    return result;
  }, { cost: 0n, retail: 0n, wholesale: 0n, expected: 0n });
}
