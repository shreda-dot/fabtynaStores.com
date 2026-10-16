import {
  getLagosBusinessDate,
  isPurchaseOverdue,
  purchaseBalanceKobo,
  purchasePaymentStatus,
} from "@fabtyna/shared";
import type {
  PayableLineDto,
  PayablesApi,
  SupplierPayableDto,
} from "./payables.api";
import { readMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const payablesMockApi: PayablesApi = {
  async listOutstanding() {
    await delay();
    const store = readMockStore();
    const today = getLagosBusinessDate();

    const productNameById = new Map(store.products.map((p) => [p.id, p.name]));
    const linesByPurchase = new Map<string, { quantity: number; productId: string }[]>();
    for (const line of store.purchaseLines) {
      const list = linesByPurchase.get(line.purchaseId) ?? [];
      list.push({ quantity: line.quantity, productId: line.productId });
      linesByPurchase.set(line.purchaseId, list);
    }

    const groups = new Map<string, SupplierPayableDto>();

    const unpaidPurchases = store.purchases.filter(
      (p) => p.status !== "VOIDED" && p.supplierId !== null && purchaseBalanceKobo(p) > 0n,
    );

    for (const purchase of unpaidPurchases) {
      const supplierId = purchase.supplierId!;
      const supplier = store.suppliers.find((s) => s.id === supplierId) ?? null;
      const balance = purchaseBalanceKobo(purchase);
      const overdue = isPurchaseOverdue(purchase, today);
      const lineItems = linesByPurchase.get(purchase.id) ?? [];
      const itemsSummary = lineItems
        .map(
          (item) =>
            `${item.quantity} × ${productNameById.get(item.productId) ?? item.productId}`,
        )
        .join(", ");
      const line: PayableLineDto = {
        purchaseId: purchase.id,
        reference: purchase.reference,
        purchasedAt: purchase.purchasedAt.toISOString(),
        dueDate: purchase.dueDate,
        totalKobo: purchase.totalKobo.toString(),
        paidKobo: purchase.paidKobo.toString(),
        balanceKobo: balance.toString(),
        status: purchasePaymentStatus(purchase),
        overdue,
        itemsSummary: itemsSummary === "" ? "—" : itemsSummary,
        lineCount: lineItems.length,
      };

      const existing = groups.get(supplierId);
      if (existing) {
        existing.balanceKobo = (
          BigInt(existing.balanceKobo) + balance
        ).toString();
        if (overdue) {
          existing.overdueKobo = (
            BigInt(existing.overdueKobo) + balance
          ).toString();
        }
        existing.purchases.push(line);
      } else {
        groups.set(supplierId, {
          supplierId,
          supplierName: supplier?.name ?? "Unknown supplier",
          balanceKobo: balance.toString(),
          overdueKobo: overdue ? balance.toString() : "0",
          purchases: [line],
        });
      }
    }

    const result = Array.from(groups.values()).sort((a, b) => {
      const diff = BigInt(b.balanceKobo) - BigInt(a.balanceKobo);
      if (diff === 0n) return a.supplierName.localeCompare(b.supplierName);
      return diff > 0n ? 1 : -1;
    });
    for (const group of result) {
      group.purchases.sort(
        (a, b) =>
          new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime(),
      );
    }
    return jsonClone(result);
  },

  async getSupplierBreakdown(supplierId) {
    const all = await this.listOutstanding();
    return all.find((entry) => entry.supplierId === supplierId) ?? null;
  },
};
