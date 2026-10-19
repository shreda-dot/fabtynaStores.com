import type {
  CreatePurchaseDto,
  PurchaseDto,
  PurchaseLineDto,
  StockMovementDto,
  SupplierDto,
  SupplierPaymentDto,
} from "@fabtyna/shared";

export type PurchaseListItemDto = PurchaseDto & {
  supplierName: string | null;
  lineCount: number;
};

export type PurchaseLineWithProductDto = PurchaseLineDto & {
  productName: string;
};

export type PurchaseDetailDto = PurchaseDto & {
  supplier: SupplierDto | null;
  lines: PurchaseLineWithProductDto[];
  movements: StockMovementDto[];
  payments: SupplierPaymentDto[];
};

export interface PurchasesApi {
  list(): Promise<PurchaseListItemDto[]>;
  getById(id: string): Promise<PurchaseDetailDto>;
  create(input: CreatePurchaseDto): Promise<PurchaseDetailDto>;
  update(id: string, input: CreatePurchaseDto): Promise<PurchaseDetailDto>;
  void(id: string): Promise<PurchaseDetailDto>;
  recordPayment(
    id: string,
    amountKobo: string,
    paidAt: string,
    method: SupplierPaymentDto["method"],
    accountId: string,
    note?: string,
  ): Promise<PurchaseDetailDto>;
}
