import {
  createSaleDtoSchema,
  fromAuditLogDto,
  recordSale,
  recordSalePayment,
  toAuditLogDto,
  toCustomerDto,
  toSaleDto,
  toSaleLineDto,
  toSalePaymentDto,
  toStockMovementDto,
  voidSale,
  type Sale,
} from "@fabtyna/shared";
import type { SalesApi, SaleDetailDto, SaleListItemDto } from "./sales.api";
import { newId, readMockStore, resolveAccountId, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  entityId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "Sale",
        entityId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function buildSaleDetail(
  store: ReturnType<typeof readMockStore>,
  sale: Sale,
): SaleDetailDto {
  const productById = new Map(store.products.map((p) => [p.id, p.name]));
  const lines = store.saleLines
    .filter((line) => line.saleId === sale.id)
    .map((line) => ({
      ...toSaleLineDto(line),
      productName: productById.get(line.productId) ?? line.productId,
    }));
  const lineIds = new Set(lines.map((l) => l.id));
  const movements = store.stockMovements
    .filter(
      (m) =>
        m.type === "SALE" &&
        m.saleLineId !== null &&
        lineIds.has(m.saleLineId),
    )
    .map(toStockMovementDto);
  const customer = sale.customerId
    ? store.customers.find((c) => c.id === sale.customerId) ?? null
    : null;
  const payments = store.salePayments
    .filter((p) => p.saleId === sale.id)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
    .map(toSalePaymentDto);
  return jsonClone({
    ...toSaleDto(sale),
    customer: customer ? toCustomerDto(customer) : null,
    lines,
    movements,
    payments,
  });
}

export const salesMockApi: SalesApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const items: SaleListItemDto[] = store.sales
      .slice()
      .sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())
      .map((sale) => {
        const customer = sale.customerId
          ? store.customers.find((c) => c.id === sale.customerId) ?? null
          : null;
        const lineCount = store.saleLines.filter(
          (l) => l.saleId === sale.id,
        ).length;
        return {
          ...toSaleDto(sale),
          customerName: customer?.name ?? sale.customerName ?? null,
          lineCount,
        };
      });
    return jsonClone(items);
  },

  async getById(id) {
    await delay();
    const store = readMockStore();
    const sale = store.sales.find((s) => s.id === id);
    if (!sale) throw new Error("Sale not found.");
    return buildSaleDetail(store, sale);
  },

  async create(input) {
    await delay();
    const data = createSaleDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const recorded = recordSale(
        {
          customerId: data.customerId,
          customerName: data.customerName,
          createdById: "admin",
          channel: data.channel,
          location: data.location,
          soldAt: new Date(data.soldAt),
          notes: data.notes,
          reference: data.reference,
          paidKobo: BigInt(data.paidKobo),
          accountId:
            BigInt(data.paidKobo) > 0n
              ? resolveAccountId(draft.accounts, data.accountId)
              : null,
          lines: data.lines.map((line) => ({
            productId: line.productId,
            unit: line.unit,
            quantity: line.quantity,
            unitPriceKobo: BigInt(line.unitPriceKobo),
          })),
        },
        draft.products,
        draft.stockMovements,
        newId,
      );

      draft.sales.push(recorded.sale);
      draft.saleLines.push(...recorded.saleLines);
      draft.stockMovements.push(...recorded.movements);
      if (recorded.customerLedgerEntry) {
        draft.customerLedgerEntries.push(recorded.customerLedgerEntry);
      }
      if (recorded.salePayment) {
        draft.salePayments.push(recorded.salePayment);
      }
      if (recorded.accountLedgerEntry) {
        draft.accountLedgerEntries.push(recorded.accountLedgerEntry);
      }
      audit(
        draft,
        "SALE_CREATED",
        recorded.sale.id,
        null,
        toSaleDto(recorded.sale),
      );
      return recorded.sale;
    });

    const store = readMockStore();
    const sale = store.sales.find((s) => s.id === result.id)!;
    return buildSaleDetail(store, sale);
  },

  async update(id, input) {
    await delay();
    const data = createSaleDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const original = draft.sales.find((s) => s.id === id);
      if (!original) throw new Error("Sale not found.");
      const before = toSaleDto(original);

      // Amending keeps the audit trail: reverse the original (immutably) and
      // record a corrected replacement instead of editing in place.
      const amendedAt = new Date();
      const voided = voidSale(
        id,
        amendedAt,
        draft.sales,
        draft.saleLines,
        draft.stockMovements,
        draft.customerLedgerEntries,
        newId,
        draft.salePayments,
        draft.accountLedgerEntries,
        draft.accounts,
      );
      original.status = "VOIDED";
      original.updatedAt = amendedAt;
      draft.stockMovements.push(...voided.reversalMovements);
      if (voided.reversalCustomerLedgerEntry) {
        draft.customerLedgerEntries.push(voided.reversalCustomerLedgerEntry);
      }
      draft.accountLedgerEntries.push(...voided.reversalAccountLedgerEntries);

      const recorded = recordSale(
        {
          customerId: data.customerId,
          customerName: data.customerName,
          createdById: "admin",
          channel: data.channel,
          location: data.location,
          soldAt: new Date(data.soldAt),
          notes: data.notes,
          reference: data.reference,
          paidKobo: BigInt(data.paidKobo),
          accountId:
            BigInt(data.paidKobo) > 0n
              ? resolveAccountId(draft.accounts, data.accountId)
              : null,
          lines: data.lines.map((line) => ({
            productId: line.productId,
            unit: line.unit,
            quantity: line.quantity,
            unitPriceKobo: BigInt(line.unitPriceKobo),
          })),
        },
        draft.products,
        draft.stockMovements,
        newId,
      );

      draft.sales.push(recorded.sale);
      draft.saleLines.push(...recorded.saleLines);
      draft.stockMovements.push(...recorded.movements);
      if (recorded.customerLedgerEntry) {
        draft.customerLedgerEntries.push(recorded.customerLedgerEntry);
      }
      if (recorded.salePayment) {
        draft.salePayments.push(recorded.salePayment);
      }
      if (recorded.accountLedgerEntry) {
        draft.accountLedgerEntries.push(recorded.accountLedgerEntry);
      }
      audit(
        draft,
        "SALE_AMENDED",
        id,
        before,
        toSaleDto(recorded.sale),
      );
      return recorded.sale;
    });

    const store = readMockStore();
    const sale = store.sales.find((s) => s.id === result.id)!;
    return buildSaleDetail(store, sale);
  },

  async void(id) {
    await delay();
    const voidedAt = new Date();
    transactMockStore((draft) => {
      const voided = voidSale(
        id,
        voidedAt,
        draft.sales,
        draft.saleLines,
        draft.stockMovements,
        draft.customerLedgerEntries,
        newId,
        draft.salePayments,
        draft.accountLedgerEntries,
        draft.accounts,
      );

      const sale = draft.sales.find((s) => s.id === id);
      if (sale) {
        sale.status = "VOIDED";
        sale.updatedAt = voidedAt;
      }
      draft.stockMovements.push(...voided.reversalMovements);
      if (voided.reversalCustomerLedgerEntry) {
        draft.customerLedgerEntries.push(voided.reversalCustomerLedgerEntry);
      }
      draft.accountLedgerEntries.push(...voided.reversalAccountLedgerEntries);
      audit(
        draft,
        "SALE_VOIDED",
        id,
        null,
        sale ? toSaleDto(sale) : null,
      );
      return sale;
    });

    const store = readMockStore();
    const sale = store.sales.find((s) => s.id === id)!;
    return buildSaleDetail(store, sale);
  },

  async recordPayment(id, amountKobo, paidAt, accountId) {
    await delay();
    const amount = BigInt(amountKobo);
    const paidAtDate = new Date(paidAt);
    const result = transactMockStore((draft) => {
      const recorded = recordSalePayment(
        {
          saleId: id,
          amountKobo: amount,
          paidAt: paidAtDate,
          accountId: resolveAccountId(draft.accounts, accountId),
        },
        draft.sales,
        newId,
      );
      const sale = draft.sales.find((s) => s.id === id);
      if (!sale) throw new Error("Sale not found.");
      const before = toSaleDto(sale);
      Object.assign(sale, recorded.sale);
      draft.salePayments.push(recorded.salePayment);
      if (recorded.customerLedgerEntry) {
        draft.customerLedgerEntries.push(recorded.customerLedgerEntry);
      }
      draft.accountLedgerEntries.push(recorded.accountLedgerEntry);
      audit(draft, "SALE_PAYMENT_RECORDED", id, before, toSaleDto(sale));
      return sale;
    });

    const store = readMockStore();
    return buildSaleDetail(store, result);
  },
};
