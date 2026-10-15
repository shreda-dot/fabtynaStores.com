import type {
  CreateTransferDto,
  StockMovementDto,
  StockTransferDto,
  StockTransferLegDto,
  StockTransferLineDto,
} from "@fabtyna/shared";

export type TransferLineWithProductDto = StockTransferLineDto & {
  productName: string;
};

export type TransferDetailDto = StockTransferDto & {
  lines: TransferLineWithProductDto[];
  legs: StockTransferLegDto[];
  movements: StockMovementDto[];
};

export interface TransfersApi {
  list(): Promise<StockTransferDto[]>;
  getById(id: string): Promise<TransferDetailDto>;
  create(input: CreateTransferDto): Promise<TransferDetailDto>;
}
