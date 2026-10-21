import { createNotConnectedError, requestJson } from "./client";
import type { StockMovementFilterDto } from "@fabtyna/shared";
import type {
  LowStockPage,
  StockApi,
  StockListOptions,
  StockListPage,
  StockViewDto,
} from "./stock.api";
import type { StockMovementDto } from "@fabtyna/shared";

type StockWireItem = {
  id: string;
  name: string;
  sku: string | null;
  packName: string;
  unitsPerPack: number;
  totalUnits: number;
  stock: Record<string, { units: number; packs: number; remainingUnits: number }>;
  worthAtCostKobo: string;
  worthAtRetailKobo: string;
  worthAtWholesaleKobo: string;
  reorderLevelUnits: number;
  lowStock: boolean;
};

type StockWirePage = {
  items: StockWireItem[];
  nextCursor: string | null;
  totals: StockListPage["totals"];
};

function queryString(options: StockListOptions, lowStock = false): string {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("q", options.search.trim());
  if (options.location) query.set("location", options.location);
  if (options.active !== undefined) query.set("active", String(options.active));
  if (!lowStock && options.nonZero !== undefined) {
    query.set("nonZero", String(options.nonZero));
  }
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  return `?${query.toString()}`;
}

function mapStockItem(item: StockWireItem): StockViewDto {
  return {
    productId: item.id,
    productName: item.name,
    sku: item.sku,
    packName: item.packName,
    unitsPerPack: item.unitsPerPack,
    totalUnits: item.totalUnits,
    byLocation: Object.entries(item.stock).map(([location, amount]) => ({
      location,
      quantityUnits: amount.units,
    })),
    worthAtCostKobo: item.worthAtCostKobo,
    worthAtRetailKobo: item.worthAtRetailKobo,
    retailWorthKobo: item.worthAtRetailKobo,
    wholesaleWorthKobo: item.worthAtWholesaleKobo,
    reorderLevelUnits: item.reorderLevelUnits,
    lowStock: item.lowStock,
  };
}

export const stockRealApi: StockApi = {
  async list(options = {}) {
    return (await this.listPage(options)).items;
  },
  async listPage(options = {}) {
    const page = await requestJson<StockWirePage>(
      `/stock${queryString(options)}`,
    );
    return {
      ...page,
      items: page.items.map(mapStockItem),
    };
  },
  async lowStock(options = {}) {
    return requestJson<LowStockPage>(`/stock/low${queryString(options, true)}`);
  },
  async movements(_filter?: StockMovementFilterDto): Promise<StockMovementDto[]> {
    throw createNotConnectedError();
  },
};
