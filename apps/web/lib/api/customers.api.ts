import type {
  CreateCustomerDto,
  CustomerDto,
  CustomerLedgerEntryDto,
  SaleDto,
} from "@fabtyna/shared";

export type CustomerListOptions = {
  search?: string;
  includeDeleted?: boolean;
};

export type CustomerDetailDto = CustomerDto & {
  ledgerEntries: CustomerLedgerEntryDto[];
  sales: SaleDto[];
  balanceOwedKobo: string;
};

export interface CustomersApi {
  list(options?: CustomerListOptions): Promise<CustomerDto[]>;
  getById(id: string): Promise<CustomerDetailDto>;
  create(input: CreateCustomerDto): Promise<CustomerDto>;
  update(id: string, input: CreateCustomerDto): Promise<CustomerDto>;
  softDelete(id: string): Promise<CustomerDto>;
  restore(id: string): Promise<CustomerDto>;
}
