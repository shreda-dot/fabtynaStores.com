import type { CreateSupplierDto, SupplierDto } from "@fabtyna/shared";

export type SupplierListOptions = {
  search?: string;
  includeDeleted?: boolean;
};

export interface SuppliersApi {
  list(options?: SupplierListOptions): Promise<SupplierDto[]>;
  create(input: CreateSupplierDto): Promise<SupplierDto>;
  update(id: string, input: CreateSupplierDto): Promise<SupplierDto>;
  softDelete(id: string): Promise<SupplierDto>;
  restore(id: string): Promise<SupplierDto>;
}
