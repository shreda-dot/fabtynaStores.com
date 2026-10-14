import {
  createSupplierDtoSchema,
  fromAuditLogDto,
  fromSupplierDto,
  toAuditLogDto,
  toSupplierDto,
  type CreateSupplierDto,
  type Supplier,
  type SupplierDto,
} from "@fabtyna/shared";
import type { SuppliersApi, SupplierListOptions } from "./suppliers.api";
import { readMockStore, transactMockStore } from "./mock-store";

function delay(): Promise<void> {
  const milliseconds = 150 + Math.floor(Math.random() * 151);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
        id: crypto.randomUUID(),
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
    const search = options.search?.trim().toLocaleLowerCase() ?? "";
    const rows = readMockStore().suppliers.filter((supplier) => {
      if (!options.includeDeleted && supplier.deletedAt !== null) return false;
      if (options.includeDeleted && supplier.deletedAt === null) return false;
      if (!search) return true;
      return (
        supplier.name.toLocaleLowerCase().includes(search) ||
        supplier.phone?.toLocaleLowerCase().includes(search) === true ||
        supplier.email?.toLocaleLowerCase().includes(search) === true
      );
    });
    return jsonClone(rows.map(toSupplierDto));
  },

  async create(input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const createdAt = new Date();
      const supplier: Supplier = {
        id: crypto.randomUUID(),
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
