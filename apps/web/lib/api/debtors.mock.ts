import { getLagosBusinessDate } from "@fabtyna/shared";
import { salesMockApi } from "./sales.mock";
import type { DebtorDto, DebtorsApi, DebtorsListOptions } from "./debtors.api";
import { mockDelay } from "./mock-transport";

function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export const debtorsMockApi: DebtorsApi = {
  async list(options: DebtorsListOptions = {}) {
    await mockDelay();
    const sales = await salesMockApi.list();
    const unpaid = sales.filter(
      (sale) =>
        sale.status !== "VOIDED" &&
        BigInt(sale.totalKobo) > BigInt(sale.paidKobo),
    );
    const details = await Promise.all(unpaid.map((sale) => salesMockApi.getById(sale.id)));
    const byId = new Map(details.map((detail) => [detail.id, detail]));
    const groups = new Map<string, DebtorDto>();
    const today = getLagosBusinessDate();

    for (const sale of unpaid) {
      const detail = byId.get(sale.id);
      if (!detail) continue;
      const balance = BigInt(detail.totalKobo) - BigInt(detail.paidKobo);
      if (balance <= 0n) continue;
      const customerId = detail.customer?.id ?? `walk-in:${detail.id}`;
      const customerName = detail.customer?.name ?? detail.customerName ?? "Walk-in";
      const search = options.search?.trim().toLocaleLowerCase();
      if (
        search &&
        !customerName.toLocaleLowerCase().includes(search) &&
        !detail.customer?.phone?.toLocaleLowerCase().includes(search)
      ) {
        continue;
      }
      if (
        options.minBalanceKobo !== undefined &&
        balance < BigInt(options.minBalanceKobo)
      ) {
        continue;
      }
      const lines = detail.lines.map((line) => ({
        productName: line.productName,
        quantity: String(line.quantity),
        unit: line.unit,
      }));
      const saleDto = {
        id: detail.id,
        reference: detail.reference,
        soldAt: detail.soldAt,
        totalKobo: detail.totalKobo,
        paidKobo: detail.paidKobo,
        balanceDueKobo: balance.toString(),
        lines,
        daysOutstanding: Math.max(
          0,
          (dayNumber(today) - dayNumber(getLagosBusinessDate(new Date(detail.soldAt)))) /
            86_400_000,
        ),
      };
      const group = groups.get(customerId);
      if (group) {
        group.balanceKobo = (BigInt(group.balanceKobo) + balance).toString();
        group.sales.push(saleDto);
        if (
          group.oldestUnpaidDate === null ||
          detail.soldAt < group.oldestUnpaidDate
        ) {
          group.oldestUnpaidDate = detail.soldAt;
        }
      } else {
        groups.set(customerId, {
          id: customerId,
          name: customerName,
          phone: detail.customer?.phone ?? null,
          type: detail.customer?.type ?? "RETAIL",
          balanceKobo: balance.toString(),
          oldestUnpaidDate: detail.soldAt,
          sales: [saleDto],
        });
      }
    }

    const items = [...groups.values()].sort((a, b) => {
      const difference = BigInt(b.balanceKobo) - BigInt(a.balanceKobo);
      return difference === 0n ? a.name.localeCompare(b.name) : difference > 0n ? 1 : -1;
    });
    return {
      items,
      grandTotalKobo: items
        .reduce((sum, item) => sum + BigInt(item.balanceKobo), 0n)
        .toString(),
      nextCursor: null,
    };
  },
  async recordPayment(saleId, amountKobo, paidAt, accountId) {
    await salesMockApi.recordPayment(saleId, amountKobo, paidAt, accountId);
  },
};
