import type {
  CreateSupplierDto,
  PurchaseDto,
  SupplierDto,
  SupplierLedgerEntryDto,
} from "@fabtyna/shared";

export type SupplierListOptions = {
  search?: string;
  includeDeleted?: boolean;
  withBalance?: boolean;
  cursor?: string;
  limit?: number;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type SupplierListItemDto = Pick<
  SupplierDto,
  "id" | "name" | "phone" | "email"
> & {
  active?: boolean;
  deletedAt?: string | null;
  balanceKobo?: string;
};

export type SupplierProfileDto = {
  supplier: CreateSupplierDto & {
    id: string;
    active: boolean;
    deletedAt?: string | null;
  };
  balanceOwedKobo: string;
  unpaidPurchases: Array<{
    id: string;
    reference: string | null;
    purchasedAt: string;
    totalKobo: string;
    paidKobo: string;
    balanceDueKobo: string;
    dueDate: string | null;
    overdue: boolean;
    daysOverdue: number;
  }>;
  recentPurchases: Array<
    Pick<PurchaseDto, "id" | "reference" | "status" | "totalKobo" | "paidKobo" | "purchasedAt">
  >;
};

export type SupplierStatementOptions = {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export type SupplierStatementEntryDto = SupplierLedgerEntryDto & {
  sourceDescription: string | null;
  isReversal: boolean;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  runningBalanceKobo: string;
};

export type SupplierStatementDto = {
  party: { id: string; name: string };
  from: string;
  to: string;
  openingBalanceKobo: string;
  closingBalanceKobo: string;
  entries: SupplierStatementEntryDto[];
  nextCursor: string | null;
};

export type SupplierFormDto = CreateSupplierDto & { id: string };
export type SupplierDetailDto = SupplierProfileDto;

export interface SuppliersApi {
  list(options?: SupplierListOptions): Promise<SupplierListItemDto[]>;
  listPage(options?: SupplierListOptions): Promise<CursorPage<SupplierListItemDto>>;
  getById(id: string): Promise<SupplierDetailDto>;
  getStatement(id: string, options?: SupplierStatementOptions): Promise<SupplierStatementDto>;
  create(input: CreateSupplierDto, idempotencyKey?: string): Promise<SupplierDto>;
  update(id: string, input: CreateSupplierDto, idempotencyKey?: string): Promise<SupplierDto>;
  softDelete(id: string, idempotencyKey?: string): Promise<SupplierDto>;
  restore(id: string, idempotencyKey?: string): Promise<SupplierDto>;
}
