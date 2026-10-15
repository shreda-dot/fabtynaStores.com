import type {
  CustomerDto,
  SaleDto,
  SaleLineDto,
  SalePaymentDto,
  StockMovementDto,
} from "@fabtyna/shared";

export type SaleListItemDto = SaleDto & {
  customerName: string | null;
  lineCount: number;
};

export type SaleLineWithProductDto = SaleLineDto & {
  productName: string;
};

export type SaleDetailDto = SaleDto & {
  customer: CustomerDto | null;
  lines: SaleLineWithProductDto[];
  movements: StockMovementDto[];
  payments: SalePaymentDto[];
};

export interface SalesApi {
  list(): Promise<SaleListItemDto[]>;
  getById(id: string): Promise<SaleDetailDto>;
  create(input: import("@fabtyna/shared").CreateSaleDto): Promise<SaleDetailDto>;
  update(
    id: string,
    input: import("@fabtyna/shared").CreateSaleDto,
  ): Promise<SaleDetailDto>;
  void(id: string): Promise<SaleDetailDto>;
  recordPayment(id: string, amountKobo: string, paidAt: string): Promise<SaleDetailDto>;
}
