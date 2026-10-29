import type {
  CreateAdjustmentDto,
  StockAdjustmentDto,
  StockAdjustmentLineDto,
  StockMovementDto,
} from "@fabtyna/shared";

export type AdjustmentLineWithProductDto = StockAdjustmentLineDto & {
  productName: string;
};

export type AdjustmentDetailDto = StockAdjustmentDto & {
  lines: AdjustmentLineWithProductDto[];
  movements: StockMovementDto[];
};

export type AdjustmentListOptions = {
  /** Lagos business dates, YYYY-MM-DD. The API defaults to today when both are missing. */
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
};

export type AdjustmentListPage = {
  items: StockAdjustmentDto[];
  nextCursor: string | null;
  /** The date range the server applied. */
  from: string | null;
  to: string | null;
};

export interface AdjustmentsApi {
  /** Real API: only today's adjustments unless dates are given; prefer listPage. */
  list(): Promise<StockAdjustmentDto[]>;
  listPage(options: AdjustmentListOptions): Promise<AdjustmentListPage>;
  getById(id: string): Promise<AdjustmentDetailDto>;
  create(input: CreateAdjustmentDto, idempotencyKey?: string): Promise<AdjustmentDetailDto>;
  void(id: string, idempotencyKey?: string): Promise<AdjustmentDetailDto>;
}