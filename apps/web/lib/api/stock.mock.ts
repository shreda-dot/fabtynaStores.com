import {
  stockByProductAndLocation,
  stockWorthAtCost,
  stockWorthAtRetail,
  stockWorthAtWholesale,
  isLowStock,
  toStockMovementDto,
} from "@fabtyna/shared";
import type {
  LowStockPage,
  StockApi,
  StockListOptions,
  StockViewDto,
} from "./stock.api";
import { readMockStore, type MockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stockViews(store: MockStore, options: StockListOptions, includeInactive = false): StockViewDto[] {
    const byProductLocation = stockByProductAndLocation(store.stockMovements);
    const views: StockViewDto[] = store.products
      .filter((p) => includeInactive || (p.deletedAt === null) === (options.active ?? true))
      .filter((p) => !options.search?.trim() || `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(options.search.trim().toLowerCase()))
      .map((product) => {
        const byLocation = byProductLocation.get(product.id) ?? new Map();
        const selected = options.location
          ? Array.from(byLocation.entries()).filter(([location]) => location === options.location)
          : Array.from(byLocation.entries());
        const movements = options.location
          ? store.stockMovements.filter((movement) => movement.location === options.location)
          : store.stockMovements;
        const totalUnits = selected.reduce(
          (sum, [, units]) => sum + units,
          0,
        );
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          packName: product.packName,
          unitsPerPack: product.unitsPerPack,
          active: product.deletedAt === null,
          averageCostKobo: product.averageCostKobo.toString(),
          retailPriceKobo: product.retailPriceKobo.toString(),
          wholesalePriceKobo: product.wholesalePriceKobo.toString(),
          totalUnits,
          byLocation: selected.map(([location, quantityUnits]) => ({
            location,
            quantityUnits,
          })),
          worthAtCostKobo: stockWorthAtCost(movements, product).toString(),
          worthAtRetailKobo: stockWorthAtRetail(movements, product).toString(),
          retailWorthKobo: stockWorthAtRetail(movements, product).toString(),
          wholesaleWorthKobo: stockWorthAtWholesale(movements, product).toString(),
          reorderLevelUnits: product.reorderLevelUnits,
          lowStock: isLowStock(movements, product),
        };
      })
      .filter((row) => options.nonZero !== true || row.totalUnits > 0)
      .sort((a, b) => a.productName.localeCompare(b.productName));
    return views;
}

export const stockMockApi: StockApi = {
  async list(options: StockListOptions = {}) {
    await delay();
    return jsonClone(stockViews(readMockStore(), options));
  },
  async listPage(options: StockListOptions = {}) {
    await delay();
    const store = readMockStore();
    const filters = { ...options, nonZero: options.nonZero ?? true };
    const items = stockViews(store, filters);
    const totalRows = stockViews(store, filters, true);
    return jsonClone({
      items,
      nextCursor: null,
      totals: {
        units: totalRows.reduce((sum, row) => sum + row.totalUnits, 0).toString(),
        worthAtCostKobo: totalRows.reduce((sum, row) => sum + BigInt(row.worthAtCostKobo), 0n).toString(),
        worthAtRetailKobo: totalRows.reduce((sum, row) => sum + BigInt(row.worthAtRetailKobo ?? row.retailWorthKobo ?? "0"), 0n).toString(),
        worthAtWholesaleKobo: totalRows.reduce((sum, row) => sum + BigInt(row.wholesaleWorthKobo), 0n).toString(),
        includeInactiveProducts: true,
      },
    });
  },

  async lowStock(options = {}) {
    const result = await stockMockApi.list(options);
    const page: LowStockPage = {
      items: result
        .filter((row) => row.lowStock)
        .map((row) => ({
          id: row.productId,
          name: row.productName,
          sku: row.sku,
          reorderLevelUnits: row.reorderLevelUnits,
          units: row.totalUnits,
          shortfallUnits: Math.max(0, row.reorderLevelUnits - row.totalUnits),
        })),
      nextCursor: null,
    };
    return jsonClone(page);
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
