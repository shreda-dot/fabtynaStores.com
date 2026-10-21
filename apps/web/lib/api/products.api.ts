import type { CreateProductDto } from "@fabtyna/shared";

export type ProductListOptions = {
  search?: string;
  includeDeleted?: boolean;
  cursor?: string;
  limit?: number;
};

export type ProductRecordDto = CreateProductDto & {
  id: string;
  averageCostKobo: string;
  active?: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasStockMovement?: boolean;
  stock?: Array<{
    location: string;
    units: number;
    packs: number;
    remainingUnits: number;
  }> | Record<string, {
    units: number;
    packs: number;
    remainingUnits: number;
  }>;
};

export type ProductFormDto = CreateProductDto & { id: string };

export type ProductMovementSummaryDto = {
  id: string;
  type: string;
  location: string;
  quantityUnits: number;
  occurredAt: string;
  reference: string | null;
};

export type ProductDetailDto = ProductRecordDto & {
  movements: ProductMovementSummaryDto[];
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export interface ProductsApi {
  list(options?: ProductListOptions): Promise<ProductRecordDto[]>;
  listPage(options?: ProductListOptions): Promise<CursorPage<ProductRecordDto>>;
  getById(id: string): Promise<ProductDetailDto>;
  create(input: CreateProductDto, idempotencyKey?: string): Promise<ProductRecordDto>;
  update(id: string, input: CreateProductDto, idempotencyKey?: string): Promise<ProductRecordDto>;
  softDelete(id: string, idempotencyKey?: string): Promise<ProductRecordDto>;
  restore(id: string, idempotencyKey?: string): Promise<ProductRecordDto>;
}
