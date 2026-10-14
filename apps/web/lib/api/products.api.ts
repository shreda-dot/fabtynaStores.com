import type { CreateProductDto, ProductDto } from "@fabtyna/shared";

export type ProductListOptions = {
  search?: string;
  includeDeleted?: boolean;
};

export interface ProductsApi {
  list(options?: ProductListOptions): Promise<ProductDto[]>;
  create(input: CreateProductDto): Promise<ProductDto>;
  update(id: string, input: CreateProductDto): Promise<ProductDto>;
  softDelete(id: string): Promise<ProductDto>;
  restore(id: string): Promise<ProductDto>;
}
