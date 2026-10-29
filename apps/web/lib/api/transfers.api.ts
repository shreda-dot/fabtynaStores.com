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

export type TransferListOptions = {
  /** Lagos business dates, YYYY-MM-DD. The API defaults to today when both are missing. */
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
};

export type TransferListPage = {
  items: StockTransferDto[];
  nextCursor: string | null;
  /** The date range the server applied. */
  from: string | null;
  to: string | null;
};

export interface TransfersApi {
  /** Real API: only today's transfers unless dates are given; prefer listPage. */
  list(): Promise<StockTransferDto[]>;
  listPage(options: TransferListOptions): Promise<TransferListPage>;
  getById(id: string): Promise<TransferDetailDto>;
  create(input: CreateTransferDto, idempotencyKey?: string): Promise<TransferDetailDto>;
}