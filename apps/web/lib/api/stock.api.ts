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
  totalUnits: number;
  byLocation: StockLocationBreakdownDto[];
  worthAtCostKobo: string;
  worthAtRetailKobo: string;
  retailWorthKobo: string;
  wholesaleWorthKobo: string;
  reorderLevelUnits: number;
  lowStock: boolean;
};

export interface StockApi {
  list(): Promise<StockViewDto[]>;
  movements(filter?: StockMovementFilterDto): Promise<StockMovementDto[]>;
}
