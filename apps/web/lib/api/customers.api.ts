import type {
  CreateCustomerDto,
  CustomerDto,
  CustomerLedgerEntryDto,
  SaleDto,
} from "@fabtyna/shared";

export type CustomerListOptions = {
  search?: string;
  includeDeleted?: boolean;
  withBalance?: boolean;
  type?: CustomerDto["type"];
  cursor?: string;
  limit?: number;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type CustomerListItemDto = Pick<
  CustomerDto,
  "id" | "name" | "type" | "phone" | "email" | "creditLimitKobo"
> & {
  active?: boolean;
  deletedAt?: string | null;
  balanceKobo?: string;
};

export type CustomerProfileDto = {
  customer: CreateCustomerDto & {
    id: string;
    active: boolean;
    deletedAt?: string | null;
  };
  balanceOwedKobo: string;
  unpaidSales: Array<{
    id: string;
    reference: string | null;
    soldAt: string;
    totalKobo: string;
    paidKobo: string;
    balanceDueKobo: string;
    daysOutstanding: number;
    linesSummary: Array<{ productName: string; quantity: string; unit: string }>;
  }>;
  recentSales: Array<
    Pick<SaleDto, "id" | "reference" | "status" | "totalKobo" | "paidKobo" | "soldAt">
  >;
};

export type CustomerStatementOptions = {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export type CustomerStatementEntryDto = CustomerLedgerEntryDto & {
  sourceDescription: string | null;
  isReversal: boolean;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  runningBalanceKobo: string;
};

export type CustomerStatementDto = {
  party: { id: string; name: string };
  from: string;
  to: string;
  openingBalanceKobo: string;
  closingBalanceKobo: string;
  entries: CustomerStatementEntryDto[];
  nextCursor: string | null;
};

export type CustomerFormDto = CreateCustomerDto & { id: string };

export type CustomerDetailDto = CustomerProfileDto;

export interface CustomersApi {
  list(options?: CustomerListOptions): Promise<CustomerListItemDto[]>;
  listPage(options?: CustomerListOptions): Promise<CursorPage<CustomerListItemDto>>;
  getById(id: string): Promise<CustomerDetailDto>;
  getStatement(id: string, options?: CustomerStatementOptions): Promise<CustomerStatementDto>;
  create(input: CreateCustomerDto, idempotencyKey?: string): Promise<CustomerDto>;
  update(id: string, input: CreateCustomerDto, idempotencyKey?: string): Promise<CustomerDto>;
  softDelete(id: string, idempotencyKey?: string): Promise<CustomerDto>;
  restore(id: string, idempotencyKey?: string): Promise<CustomerDto>;
}
