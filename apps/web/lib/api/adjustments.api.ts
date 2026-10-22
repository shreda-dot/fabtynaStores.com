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

export interface AdjustmentsApi {
  list(): Promise<StockAdjustmentDto[]>;
  getById(id: string): Promise<AdjustmentDetailDto>;
  create(input: CreateAdjustmentDto, idempotencyKey?: string): Promise<AdjustmentDetailDto>;
  void(id: string, idempotencyKey?: string): Promise<AdjustmentDetailDto>;
}
