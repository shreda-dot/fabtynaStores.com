import {
  stockByProductAndLocation,
  stockWorthAtCost,
  stockWorthAtRetail,
  stockWorthByChannel,
  isLowStock,
  toStockMovementDto,
} from "@fabtyna/shared";
import type { StockApi, StockViewDto } from "./stock.api";
import { readMockStore } from "./mock-store";

function delay(): Promise<void> {
  const milliseconds = 150 + Math.floor(Math.random() * 151);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const stockMockApi: StockApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const byProductLocation = stockByProductAndLocation(store.stockMovements);
    const views: StockViewDto[] = store.products
      .filter((p) => p.deletedAt === null)
      .map((product) => {
        const byLocation = byProductLocation.get(product.id) ?? new Map();
        const totalUnits = Array.from(byLocation.values()).reduce(
          (sum, units) => sum + units,
          0,
        );
        const channelWorth = stockWorthByChannel(store.stockMovements, product);
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          packName: product.packName,
          unitsPerPack: product.unitsPerPack,
          totalUnits,
          byLocation: Array.from(byLocation.entries()).map(([location, quantityUnits]) => ({
            location,
            quantityUnits,
          })),
          worthAtCostKobo: stockWorthAtCost(store.stockMovements, product).toString(),
          worthAtRetailKobo: stockWorthAtRetail(store.stockMovements, product).toString(),
          retailWorthKobo: channelWorth.retailKobo.toString(),
          wholesaleWorthKobo: channelWorth.wholesaleKobo.toString(),
          reorderLevelUnits: product.reorderLevelUnits,
          lowStock: isLowStock(store.stockMovements, product),
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
    return jsonClone(views);
  },

  async movements(filter) {
    await delay();
    const store = readMockStore();
    let rows = store.stockMovements.slice();
    if (filter?.productId) {
      rows = rows.filter((m) => m.productId === filter.productId);
    }
    if (filter?.location) {
      rows = rows.filter((m) => m.location === filter.location);
    }
    if (filter?.type) {
      rows = rows.filter((m) => m.type === filter.type);
    }
    rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return jsonClone(rows.map(toStockMovementDto));
  },
};
