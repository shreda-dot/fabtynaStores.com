import type {
  CreateSupplierDto,
  PurchaseDto,
  SupplierDto,
  SupplierLedgerEntryDto,
} from "@fabtyna/shared";

export type SupplierListOptions = {
  search?: string;
  includeDeleted?: boolean;
};

export type SupplierDetailDto = SupplierDto & {
  ledgerEntries: SupplierLedgerEntryDto[];
  purchases: PurchaseDto[];
  balanceOwedKobo: string;
};

export interface SuppliersApi {
  list(options?: SupplierListOptions): Promise<SupplierDto[]>;
  getById(id: string): Promise<SupplierDetailDto>;
  create(input: CreateSupplierDto): Promise<SupplierDto>;
  update(id: string, input: CreateSupplierDto): Promise<SupplierDto>;
  softDelete(id: string): Promise<SupplierDto>;
  restore(id: string): Promise<SupplierDto>;
}
