import type { PaymentMethod, PurchasePaymentStatus } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  PayablesApi,
  PayablesListOptions,
  PayablesPage,
  PayableLineDto,
  SupplierPayableDto,
} from "./payables.api";

type PayableWireLine = {
  id: string;
  reference: string | null;
  purchasedAt: string;
  dueDate: string | null;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo: string;
  overdue: boolean;
  daysOverdue: number;
};

type PayableWireGroup = {
  id: string;
  name: string;
  phone: string | null;
  balanceKobo: string;
  purchases: PayableWireLine[];
};

type PayableWirePage = {
  items: PayableWireGroup[];
  grandTotalKobo: string;
  overdueTotalKobo: string;
  nextCursor: string | null;
};

function queryString(options: PayablesListOptions): string {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("q", options.search.trim());
  if (options.overdueOnly !== undefined) {
    query.set("overdueOnly", String(options.overdueOnly));
  }
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  return `?${query.toString()}`;
}

function paymentStatus(line: PayableWireLine): PurchasePaymentStatus {
  if (BigInt(line.balanceDueKobo) === 0n) return "PAID";
  return BigInt(line.paidKobo) === 0n ? "UNPAID" : "PARTIAL";
}

function mapLine(line: PayableWireLine): PayableLineDto {
  return {
    purchaseId: line.id,
    reference: line.reference,
    purchasedAt: line.purchasedAt,
    dueDate: line.dueDate,
    totalKobo: line.totalKobo,
    paidKobo: line.paidKobo,
    balanceKobo: line.balanceDueKobo,
    status: paymentStatus(line),
    overdue: line.overdue,
  };
}

function mapGroup(group: PayableWireGroup): SupplierPayableDto {
  return {
    supplierId: group.id,
    supplierName: group.name,
    balanceKobo: group.balanceKobo,
    overdueKobo: group.purchases
      .filter((purchase) => purchase.overdue)
      .reduce((sum, purchase) => sum + BigInt(purchase.balanceDueKobo), 0n)
      .toString(),
    purchases: group.purchases.map(mapLine),
  };
}

export const payablesRealApi: PayablesApi = {
  async listOutstanding(options = {}) {
    const response = await requestJson<PayableWirePage>(
      `/payables${queryString(options)}`,
    );
    const result: PayablesPage = {
      ...response,
      items: response.items.map(mapGroup),
    };
    return result;
  },
  async getSupplierBreakdown(supplierId) {
    const profile = await requestJson<{
      supplier: { id: string; name: string };
      balanceKobo: string;
      unpaidPurchases: PayableWireLine[];
    }>(`/suppliers/${encodeURIComponent(supplierId)}`);
    if (profile.unpaidPurchases.length === 0) return null;
    return mapGroup({
      id: profile.supplier.id,
      name: profile.supplier.name,
      phone: null,
      balanceKobo: profile.balanceKobo,
      purchases: profile.unpaidPurchases,
    });
  },
  async recordPayment(
    purchaseId: string,
    amountKobo: string,
    paidAt: string,
    method: PaymentMethod,
    accountId: string,
    note?: string,
    idempotencyKey?: string,
  ) {
    await requestJson<void>(
      `/purchases/${encodeURIComponent(purchaseId)}/payments`,
      {
        method: "POST",
        body: {
          amountKobo,
          paidAt,
          method,
          accountId,
          ...(note === undefined ? {} : { note }),
        },
        idempotencyKey,
      },
    );
  },
};
