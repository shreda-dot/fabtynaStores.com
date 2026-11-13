import type {
  StockMovementDto,
  StockMovementFilterDto,
} from "@fabtyna/shared";

export type StockLocationBreakdownDto = {
  location: string;
  quantityUnits: number;
};

export type StockViewDto = {
  productId: string;
  productName: string;
  sku: string | null;
  packName: string;
  unitsPerPack: number;
  active: boolean;
  averageCostKobo: string;
  retailPriceKobo: string;
  wholesalePriceKobo: string;
  totalUnits: number;
  byLocation: StockLocationBreakdownDto[];
  worthAtCostKobo: string;
  worthAtRetailKobo?: string;
  retailWorthKobo: string;
  wholesaleWorthKobo: string;
  reorderLevelUnits: number;
  lowStock: boolean;
};

export type StockListOptions = {
  search?: string;
  location?: string;
  active?: boolean;
  nonZero?: boolean;
  cursor?: string;
  limit?: number;
};

export type StockListPage = {
  items: StockViewDto[];
  nextCursor: string | null;
  totals: {
    units: string;
    worthAtCostKobo: string;
    worthAtRetailKobo: string;
    worthAtWholesaleKobo: string;
    includeInactiveProducts: boolean;
  };
};

export type LowStockItemDto = {
  id: string;
  name: string;
  sku: string | null;
  reorderLevelUnits: number;
  units: number;
  shortfallUnits: number;
};

export type LowStockPage = {
  items: LowStockItemDto[];
  nextCursor: string | null;
};

export interface StockApi {
  list(options?: StockListOptions): Promise<StockViewDto[]>;
  listPage(options?: StockListOptions): Promise<StockListPage>;
  lowStock(options?: StockListOptions): Promise<LowStockPage>;
  movements(filter?: StockMovementFilterDto): Promise<StockMovementDto[]>;
}

export async function listAllStock(api: StockApi): Promise<StockViewDto[]> {
  const items: StockViewDto[] = [];
  for (const active of [true, false]) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await api.listPage({ active, nonZero: true, limit: 200, cursor });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error("Stock pagination returned a repeated cursor.");
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  return items.sort((a, b) => a.productName.localeCompare(b.productName) || a.productId.localeCompare(b.productId));
}
