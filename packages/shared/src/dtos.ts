import type {
  AccountLedgerEntry,
  AdminUserPublic,
  AuditLog,
  Customer,
  CustomerLedgerEntry,
  Product,
  Purchase,
  PurchaseLine,
  StockAdjustment,
  StockAdjustmentLine,
  StockMovement,
  StockTransfer,
  StockTransferLine,
  StockTransferLeg,
  Supplier,
  SupplierLedgerEntry,
} from "./domain/types.js";

export type SerializedDto<T> = {
  [Key in keyof T]: T[Key] extends bigint
    ? string
    : T[Key] extends Date | null
      ? string | Exclude<T[Key], Date>
      : T[Key];
};

export type AdminUserPublicDto = SerializedDto<AdminUserPublic>;
export type AuditLogDto = SerializedDto<AuditLog>;
export type ProductDto = SerializedDto<Product>;
export type SupplierDto = SerializedDto<Supplier>;
export type CustomerDto = SerializedDto<Customer>;
export type PurchaseDto = SerializedDto<Purchase>;
export type PurchaseLineDto = SerializedDto<PurchaseLine>;
export type StockTransferDto = SerializedDto<StockTransfer>;
export type StockTransferLineDto = SerializedDto<StockTransferLine>;
export type StockTransferLegDto = SerializedDto<StockTransferLeg>;
export type StockAdjustmentDto = SerializedDto<StockAdjustment>;
export type StockAdjustmentLineDto = SerializedDto<StockAdjustmentLine>;
export type StockMovementDto = SerializedDto<StockMovement>;
export type CustomerLedgerEntryDto = SerializedDto<CustomerLedgerEntry>;
export type SupplierLedgerEntryDto = SerializedDto<SupplierLedgerEntry>;
export type AccountLedgerEntryDto = SerializedDto<AccountLedgerEntry>;

export type CreateProductDto = {
  name: string;
  sku: string | null;
  category: Product["category"];
  packName: string;
  unitsPerPack: number;
  retailPriceKobo: string;
  wholesalePriceKobo: string;
  reorderLevelUnits: number;
};

export type CreateSupplierDto = Pick<
  Supplier,
  "name" | "phone" | "email" | "address" | "notes"
>;

export type PurchaseReceiveLineDto = {
  purchaseLineId: string;
  quantityUnits: number;
  lineTotalKobo: string;
};

export type PurchaseReceiveDto = {
  lines: PurchaseReceiveLineDto[];
  receivedAt?: string;
};
