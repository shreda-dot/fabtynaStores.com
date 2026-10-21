import {
  createSupplierDtoSchema,
  fromAuditLogDto,
  fromSupplierDto,
  getLagosBusinessDate,
  toAuditLogDto,
  toPurchaseDto,
  toSupplierDto,
  toSupplierLedgerEntryDto,
  type CreateSupplierDto,
  type Supplier,
  type SupplierDto,
} from "@fabtyna/shared";
import type {
  SupplierDetailDto,
  SupplierListOptions,
  SupplierStatementOptions,
  SuppliersApi,
} from "./suppliers.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function response(supplier: Supplier): SupplierDto {
  return jsonClone(toSupplierDto(supplier));
}

function validated(input: CreateSupplierDto): CreateSupplierDto {
  return createSupplierDtoSchema.parse(input);
}

function findSupplier(suppliers: Supplier[], id: string): Supplier {
  const supplier = suppliers.find((item) => item.id === id);
  if (!supplier) throw new Error("Supplier not found.");
  return supplier;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  supplierId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "Supplier",
        entityId: supplierId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

export const suppliersMockApi: SuppliersApi = {
  async list(options: SupplierListOptions = {}) {
    await delay();
    const store = readMockStore();
    const search = options.search?.trim().toLocaleLowerCase() ?? "";
    const rows = store.suppliers.filter((supplier) => {
      if (!options.includeDeleted && supplier.deletedAt !== null) return false;
      if (options.includeDeleted && supplier.deletedAt === null) return false;
      const balance = store.supplierLedgerEntries
        .filter((entry) => entry.supplierId === supplier.id)
        .reduce((sum, entry) => sum + entry.amountKobo, 0n);
      if (options.withBalance === true && balance <= 0n) return false;
      if (options.withBalance === false && balance > 0n) return false;
      if (!search) return true;
      return (
        supplier.name.toLocaleLowerCase().includes(search) ||
        supplier.phone?.toLocaleLowerCase().includes(search) === true ||
        supplier.email?.toLocaleLowerCase().includes(search) === true
      );
    });
    return jsonClone(
      rows.map((supplier) => ({
        ...toSupplierDto(supplier),
        active: supplier.deletedAt === null,
        balanceKobo: store.supplierLedgerEntries
          .filter((entry) => entry.supplierId === supplier.id)
          .reduce((sum, entry) => sum + entry.amountKobo, 0n)
          .toString(),
      })),
    );
  },
  async listPage(options: SupplierListOptions = {}) {
    const items = await suppliersMockApi.list(options);
    return jsonClone({ items, nextCursor: null });
  },

  async getById(id) {
    await delay();
    const store = readMockStore();
    const supplier = findSupplier(store.suppliers, id);
    const ledgerEntries = store.supplierLedgerEntries
      .filter((entry) => entry.supplierId === id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const purchases = store.purchases
      .filter((purchase) => purchase.supplierId === id)
      .sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime());
    const balanceOwedKobo = ledgerEntries.reduce(
      (sum, entry) => sum + entry.amountKobo,
      0n,
    );
    const today = getLagosBusinessDate();
    const dayNumber = (value: string) => {
      const [year, month, day] = value.split("-").map(Number);
      return Date.UTC(year, month - 1, day);
    };
    const detail: SupplierDetailDto = {
      supplier: {
        ...toSupplierDto(supplier),
        active: supplier.deletedAt === null,
      },
      balanceOwedKobo: balanceOwedKobo.toString(),
      unpaidPurchases: purchases
        .filter(
          (purchase) =>
            purchase.status !== "VOIDED" &&
            purchase.totalKobo > purchase.paidKobo,
        )
        .map((purchase) => ({
          id: purchase.id,
          reference: purchase.reference,
          purchasedAt: purchase.purchasedAt.toISOString(),
          totalKobo: purchase.totalKobo.toString(),
          paidKobo: purchase.paidKobo.toString(),
          balanceDueKobo: (purchase.totalKobo - purchase.paidKobo).toString(),
          dueDate: purchase.dueDate,
          overdue: purchase.dueDate !== null && purchase.dueDate < today,
          daysOverdue:
            purchase.dueDate !== null && purchase.dueDate < today
              ? (dayNumber(today) - dayNumber(purchase.dueDate)) / 86_400_000
              : 0,
        })),
      recentPurchases: purchases.slice(0, 10).map((purchase) => {
        const dto = toPurchaseDto(purchase);
        return {
          id: dto.id,
          reference: dto.reference,
          status: dto.status,
          totalKobo: dto.totalKobo,
          paidKobo: dto.paidKobo,
          purchasedAt: dto.purchasedAt,
        };
      }),
    };
    return jsonClone(detail);
  },

  async getStatement(id, options: SupplierStatementOptions = {}) {
    await delay();
    const store = readMockStore();
    const supplier = findSupplier(store.suppliers, id);
    const entries = store.supplierLedgerEntries
      .filter((entry) => entry.supplierId === id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let runningBalance = 0n;
    const mapped = entries.map((entry) => {
      runningBalance += entry.amountKobo;
      const dto = toSupplierLedgerEntryDto(entry);
      const reversedBy = entries.find((candidate) => candidate.reversesEntryId === entry.id);
      return {
        ...dto,
        sourceDescription:
          entry.purchaseId === null ? entry.note ?? entry.type : "Purchase",
        isReversal: entry.reversesEntryId !== null,
        reversesEntryId: entry.reversesEntryId,
        reversedByEntryId: reversedBy?.id ?? null,
        runningBalanceKobo: runningBalance.toString(),
      };
    });
    return jsonClone({
      party: { id: supplier.id, name: supplier.name },
      from: options.from ?? "",
      to: options.to ?? getLagosBusinessDate(),
      openingBalanceKobo: "0",
      closingBalanceKobo: runningBalance.toString(),
      entries: mapped,
      nextCursor: null,
    });
  },

  async create(input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const createdAt = new Date();
      const supplier: Supplier = {
        id: newId(),
        ...data,
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      draft.suppliers.push(supplier);
      audit(draft, "SUPPLIER_CREATED", supplier.id, null, toSupplierDto(supplier));
      return supplier;
    });
    return response(result);
  },

  async update(id, input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const supplier = findSupplier(draft.suppliers, id);
      if (supplier.deletedAt !== null) {
        throw new Error("Restore this supplier before editing it.");
      }
      const before = toSupplierDto(supplier);
      Object.assign(supplier, data, {
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        updatedAt: new Date(),
      });
      audit(draft, "SUPPLIER_UPDATED", id, before, toSupplierDto(supplier));
      return supplier;
    });
    return response(result);
  },

  async softDelete(id) {
    await delay();
    const result = transactMockStore((draft) => {
      const supplier = findSupplier(draft.suppliers, id);
      if (supplier.deletedAt !== null) throw new Error("Supplier is already deleted.");
      const before = toSupplierDto(supplier);
      supplier.deletedAt = new Date();
      supplier.updatedAt = supplier.deletedAt;
      audit(draft, "SUPPLIER_SOFT_DELETED", id, before, toSupplierDto(supplier));
      return supplier;
    });
    return response(result);
  },

  async restore(id) {
    await delay();
    const result = transactMockStore((draft) => {
      const supplier = findSupplier(draft.suppliers, id);
      if (supplier.deletedAt === null) throw new Error("Supplier is already active.");
      const before = toSupplierDto(supplier);
      supplier.deletedAt = null;
      supplier.updatedAt = new Date();
      audit(draft, "SUPPLIER_RESTORED", id, before, toSupplierDto(supplier));
      return supplier;
    });
    return response(result);
  },
};

export function supplierDtoToDomain(dto: SupplierDto): Supplier {
  return fromSupplierDto(dto);
}
