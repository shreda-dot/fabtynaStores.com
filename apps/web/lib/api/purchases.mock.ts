import {
  createPurchaseDtoSchema,
  fromAuditLogDto,
  getLagosBusinessDate,
  receivePurchase,
  recordPurchasePayment,
  toAuditLogDto,
  toPurchaseDto,
  toPurchaseLineDto,
  toStockMovementDto,
  toSupplierDto,
  toSupplierPaymentDto,
  voidPurchase,
  type Purchase,
} from "@fabtyna/shared";
import type {
  PurchasesApi,
  PurchaseDetailDto,
  PurchaseListItemDto,
} from "./purchases.api";
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
        entityType: "Purchase",
        entityId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function buildPurchaseDetail(
  store: ReturnType<typeof readMockStore>,
  purchase: Purchase,
): PurchaseDetailDto {
  const productById = new Map(store.products.map((p) => [p.id, p.name]));
  const lines = store.purchaseLines
    .filter((line) => line.purchaseId === purchase.id)
    .map((line) => ({
      ...toPurchaseLineDto(line),
      productName: productById.get(line.productId) ?? line.productId,
    }));
  const lineIds = new Set(lines.map((l) => l.id));
  const movements = store.stockMovements
    .filter(
      (m) =>
        m.type === "PURCHASE" &&
        m.purchaseLineId !== null &&
        lineIds.has(m.purchaseLineId),
    )
    .map(toStockMovementDto);
  const supplier = purchase.supplierId
    ? store.suppliers.find((s) => s.id === purchase.supplierId) ?? null
    : null;
  const payments = store.supplierPayments
    .filter((p) => p.purchaseId === purchase.id)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
    .map(toSupplierPaymentDto);
  return jsonClone({
    ...toPurchaseDto(purchase),
    supplier: supplier ? toSupplierDto(supplier) : null,
    lines,
    movements,
    payments,
  });
}

export const purchasesMockApi: PurchasesApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const items: PurchaseListItemDto[] = store.purchases
      .slice()
      .sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime())
      .map((purchase) => {
        const supplier = purchase.supplierId
          ? store.suppliers.find((s) => s.id === purchase.supplierId) ?? null
          : null;
        const lineCount = store.purchaseLines.filter(
          (l) => l.purchaseId === purchase.id,
        ).length;
        return {
          ...toPurchaseDto(purchase),
          supplierName: supplier?.name ?? null,
          lineCount,
        };
      });
    return jsonClone(items);
  },

  async listPage(options) {
    const all = await purchasesMockApi.list();
    const search = options.search?.trim().toLowerCase() ?? "";
    const wide =
      options.unpaid === true ||
      options.overdue === true ||
      search !== "" ||
      options.supplierId !== undefined;
    const today = getLagosBusinessDate(new Date());
    const items = all.filter((purchase) => {
      const day = getLagosBusinessDate(new Date(purchase.purchasedAt));
      if (!wide && options.from && day < options.from) return false;
      if (!wide && options.to && day > options.to) return false;
      if (options.status && purchase.status !== options.status) return false;
      if (options.supplierId && purchase.supplierId !== options.supplierId) return false;
      const owed =
        purchase.status !== "VOIDED" && BigInt(purchase.totalKobo) > BigInt(purchase.paidKobo);
      if (options.unpaid && !owed) return false;
      if (options.overdue && !(owed && purchase.dueDate !== null && purchase.dueDate < today)) {
        return false;
      }
      if (
        search !== "" &&
        !(purchase.reference ?? "").toLowerCase().includes(search) &&
        !(purchase.supplierName ?? "").toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });
    return { items, nextCursor: null, from: options.from ?? null, to: options.to ?? null };
  },

  async getById(id) {
    await delay();
    const store = readMockStore();
    const purchase = store.purchases.find((p) => p.id === id);
    if (!purchase) throw new Error("Purchase not found.");
    return buildPurchaseDetail(store, purchase);
  },

  async create(input) {
    await delay();
    const data = createPurchaseDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const existingProducts = draft.products;
      const existingMovements = draft.stockMovements;
      const received = receivePurchase(
        {
          supplierId: data.supplierId,
          createdById: "admin",
          location: data.location,
          purchasedAt: new Date(data.purchasedAt),
          notes: data.notes,
          reference: data.reference,
          amountPaidNowKobo: BigInt(data.amountPaidNowKobo),
          dueDate: data.dueDate,
          paymentMethod: data.paymentMethod,
          accountId:
            BigInt(data.amountPaidNowKobo) > 0n
              ? resolveAccountId(
                  draft.accounts,
                  data.accountId,
                  data.paymentMethod === "TRANSFER" ? "BANK" : "CASH",
                )
              : null,
          lines: data.lines.map((line) => ({
            productId: line.productId,
            unit: line.unit,
            quantity: line.quantity,
            lineTotalKobo: BigInt(line.lineTotalKobo),
          })),
        },
        existingProducts,
        existingMovements,
        newId,
      );

      draft.purchases.push(received.purchase);
      draft.purchaseLines.push(...received.purchaseLines);
      draft.stockMovements.push(...received.movements);
      if (received.supplierLedgerEntry) {
        draft.supplierLedgerEntries.push(received.supplierLedgerEntry);
      }
      if (received.supplierPayment) {
        draft.supplierPayments.push(received.supplierPayment);
      }
      if (received.supplierPaymentLedgerEntry) {
        draft.supplierLedgerEntries.push(received.supplierPaymentLedgerEntry);
      }
      if (received.accountLedgerEntry) {
        draft.accountLedgerEntries.push(received.accountLedgerEntry);
      }
      for (const update of received.productUpdates) {
        const product = draft.products.find((p) => p.id === update.id);
        if (product) product.averageCostKobo = update.averageCostKobo;
      }
      audit(
        draft,
        "PURCHASE_CREATED",
        received.purchase.id,
        null,
        toPurchaseDto(received.purchase),
      );
      return received.purchase;
    });

    const store = readMockStore();
    const purchase = store.purchases.find((p) => p.id === result.id)!;
    return buildPurchaseDetail(store, purchase);
  },

  async update(id, input) {
    await delay();
    const data = createPurchaseDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const original = draft.purchases.find((p) => p.id === id);
      if (!original) throw new Error("Purchase not found.");
      const before = toPurchaseDto(original);

      // Amending keeps the audit trail: reverse the original (immutably) and
      // record a corrected replacement instead of editing in place. A purchase
      // that already has supplier payments cannot be voided, so the domain
      // throws and the amendment is blocked (payments are immutable).
      const amendedAt = new Date();
      const voided = voidPurchase(
        id,
        amendedAt,
        draft.purchases,
        draft.purchaseLines,
        draft.stockMovements,
        draft.supplierLedgerEntries,
        newId,
        draft.supplierPayments,
        draft.accountLedgerEntries,
        draft.accounts,
      );
      original.status = "VOIDED";
      original.updatedAt = amendedAt;
      draft.stockMovements.push(...voided.reversalMovements);
      if (voided.reversalSupplierLedgerEntry) {
        draft.supplierLedgerEntries.push(voided.reversalSupplierLedgerEntry);
      }
      draft.accountLedgerEntries.push(...voided.reversalAccountLedgerEntries);
      for (const pu of voided.productUpdates) {
        const product = draft.products.find((p) => p.id === pu.id);
        if (product) product.averageCostKobo = pu.averageCostKobo;
      }

      const received = receivePurchase(
        {
          supplierId: data.supplierId,
          createdById: "admin",
          location: data.location,
          purchasedAt: new Date(data.purchasedAt),
          notes: data.notes,
          reference: data.reference,
          amountPaidNowKobo: BigInt(data.amountPaidNowKobo),
          dueDate: data.dueDate,
          paymentMethod: data.paymentMethod,
          accountId:
            BigInt(data.amountPaidNowKobo) > 0n
              ? resolveAccountId(
                  draft.accounts,
                  data.accountId,
                  data.paymentMethod === "TRANSFER" ? "BANK" : "CASH",
                )
              : null,
          lines: data.lines.map((line) => ({
            productId: line.productId,
            unit: line.unit,
            quantity: line.quantity,
            lineTotalKobo: BigInt(line.lineTotalKobo),
          })),
        },
        draft.products,
        draft.stockMovements,
        newId,
      );

      draft.purchases.push(received.purchase);
      draft.purchaseLines.push(...received.purchaseLines);
      draft.stockMovements.push(...received.movements);
      if (received.supplierLedgerEntry) {
        draft.supplierLedgerEntries.push(received.supplierLedgerEntry);
      }
      if (received.supplierPayment) {
        draft.supplierPayments.push(received.supplierPayment);
      }
      if (received.supplierPaymentLedgerEntry) {
        draft.supplierLedgerEntries.push(received.supplierPaymentLedgerEntry);
      }
      if (received.accountLedgerEntry) {
        draft.accountLedgerEntries.push(received.accountLedgerEntry);
      }
      for (const pu of received.productUpdates) {
        const product = draft.products.find((p) => p.id === pu.id);
        if (product) product.averageCostKobo = pu.averageCostKobo;
      }

      audit(
        draft,
        "PURCHASE_AMENDED",
        id,
        before,
        toPurchaseDto(received.purchase),
      );
      return received.purchase;
    });

    const store = readMockStore();
    const purchase = store.purchases.find((p) => p.id === result.id)!;
    return { ...buildPurchaseDetail(store, purchase), voidedPurchaseId: id };
  },

  async void(id) {
    await delay();
    const voidedAt = new Date();
    transactMockStore((draft) => {
      const existingPurchases = draft.purchases;
      const existingPurchaseLines = draft.purchaseLines;
      const existingMovements = draft.stockMovements;
      const existingLedger = draft.supplierLedgerEntries;

      const voided = voidPurchase(
        id,
        voidedAt,
        existingPurchases,
        existingPurchaseLines,
        existingMovements,
        existingLedger,
        newId,
        draft.supplierPayments,
        draft.accountLedgerEntries,
        draft.accounts,
      );

      const purchase = draft.purchases.find((p) => p.id === id);
      if (purchase) {
        purchase.status = "VOIDED";
        purchase.updatedAt = voidedAt;
      }
      draft.stockMovements.push(...voided.reversalMovements);
      if (voided.reversalSupplierLedgerEntry) {
        draft.supplierLedgerEntries.push(voided.reversalSupplierLedgerEntry);
      }
      draft.accountLedgerEntries.push(...voided.reversalAccountLedgerEntries);
      for (const update of voided.productUpdates) {
        const product = draft.products.find((p) => p.id === update.id);
        if (product) product.averageCostKobo = update.averageCostKobo;
      }
      audit(
        draft,
        "PURCHASE_VOIDED",
        id,
        null,
        purchase ? toPurchaseDto(purchase) : null,
      );
      return purchase;
    });

    const store = readMockStore();
    const purchase = store.purchases.find((p) => p.id === id)!;
    return buildPurchaseDetail(store, purchase);
  },

  async recordPayment(id, amountKobo, paidAt, method, accountId, note) {
    await delay();
    const amount = BigInt(amountKobo);
    const paidAtDate = new Date(paidAt);
    const result = transactMockStore((draft) => {
      const recorded = recordPurchasePayment(
        {
          purchaseId: id,
          amountKobo: amount,
          paidAt: paidAtDate,
          method,
          note: note ?? null,
          accountId: resolveAccountId(
            draft.accounts,
            accountId,
            method === "TRANSFER" ? "BANK" : "CASH",
          ),
        },
        draft.purchases,
        newId,
      );
      const purchase = draft.purchases.find((p) => p.id === id);
      if (!purchase) throw new Error("Purchase not found.");
      const before = toPurchaseDto(purchase);
      Object.assign(purchase, recorded.purchase);
      draft.supplierPayments.push(recorded.supplierPayment);
      draft.supplierLedgerEntries.push(recorded.supplierLedgerEntry);
      draft.accountLedgerEntries.push(recorded.accountLedgerEntry);
      audit(draft, "PURCHASE_PAYMENT_RECORDED", id, before, toPurchaseDto(purchase));
      return purchase;
    });

    const store = readMockStore();
    return buildPurchaseDetail(store, result);
  },

  async reversePayment() {
    await delay();
    throw new Error("Reversing a payment is only available when connected to the real API.");
  },
};
