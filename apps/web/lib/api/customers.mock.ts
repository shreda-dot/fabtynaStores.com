import {
  createCustomerDtoSchema,
  fromAuditLogDto,
  toAuditLogDto,
  toCustomerDto,
  toCustomerLedgerEntryDto,
  toSaleDto,
  type CreateCustomerDto,
  type Customer,
  type CustomerDto,
} from "@fabtyna/shared";
import type {
  CustomersApi,
  CustomerDetailDto,
  CustomerListOptions,
} from "./customers.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";

function delay(): Promise<void> {
  const milliseconds = 150 + Math.floor(Math.random() * 151);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function response(customer: Customer): CustomerDto {
  return jsonClone(toCustomerDto(customer));
}

function validated(input: CreateCustomerDto): CreateCustomerDto {
  return createCustomerDtoSchema.parse(input);
}

function findCustomer(customers: Customer[], id: string): Customer {
  const customer = customers.find((item) => item.id === id);
  if (!customer) throw new Error("Customer not found.");
  return customer;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  customerId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "Customer",
        entityId: customerId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

export const customersMockApi: CustomersApi = {
  async list(options: CustomerListOptions = {}) {
    await delay();
    const search = options.search?.trim().toLocaleLowerCase() ?? "";
    const rows = readMockStore().customers.filter((customer) => {
      if (!options.includeDeleted && customer.deletedAt !== null) return false;
      if (options.includeDeleted && customer.deletedAt === null) return false;
      if (!search) return true;
      return (
        customer.name.toLocaleLowerCase().includes(search) ||
        customer.phone?.toLocaleLowerCase().includes(search) === true ||
        customer.email?.toLocaleLowerCase().includes(search) === true
      );
    });
    return jsonClone(rows.map(toCustomerDto));
  },

  async getById(id) {
    await delay();
    const store = readMockStore();
    const customer = findCustomer(store.customers, id);
    const ledgerEntries = store.customerLedgerEntries
      .filter((entry) => entry.customerId === id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const sales = store.sales
      .filter((sale) => sale.customerId === id)
      .sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime());
    const balanceOwedKobo = ledgerEntries.reduce(
      (sum, entry) => sum + entry.amountKobo,
      0n,
    );
    const detail: CustomerDetailDto = {
      ...toCustomerDto(customer),
      ledgerEntries: jsonClone(ledgerEntries.map(toCustomerLedgerEntryDto)),
      sales: jsonClone(sales.map(toSaleDto)),
      balanceOwedKobo: balanceOwedKobo.toString(),
    };
    return jsonClone(detail);
  },

  async create(input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const createdAt = new Date();
      const customer: Customer = {
        id: newId(),
        name: data.name.trim(),
        type: data.type,
        creditLimitKobo: BigInt(data.creditLimitKobo),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      draft.customers.push(customer);
      audit(draft, "CUSTOMER_CREATED", customer.id, null, toCustomerDto(customer));
      return customer;
    });
    return response(result);
  },

  async update(id, input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const customer = findCustomer(draft.customers, id);
      if (customer.deletedAt !== null) {
        throw new Error("Restore this customer before editing it.");
      }
      const before = toCustomerDto(customer);
      Object.assign(customer, {
        name: data.name.trim(),
        type: data.type,
        creditLimitKobo: BigInt(data.creditLimitKobo),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        updatedAt: new Date(),
      });
      audit(draft, "CUSTOMER_UPDATED", id, before, toCustomerDto(customer));
      return customer;
    });
    return response(result);
  },

  async softDelete(id) {
    await delay();
    const result = transactMockStore((draft) => {
      const customer = findCustomer(draft.customers, id);
      if (customer.deletedAt !== null) throw new Error("Customer is already deleted.");
      const before = toCustomerDto(customer);
      customer.deletedAt = new Date();
      customer.updatedAt = customer.deletedAt;
      audit(draft, "CUSTOMER_SOFT_DELETED", id, before, toCustomerDto(customer));
      return customer;
    });
    return response(result);
  },

  async restore(id) {
    await delay();
    const result = transactMockStore((draft) => {
      const customer = findCustomer(draft.customers, id);
      if (customer.deletedAt === null) throw new Error("Customer is already active.");
      const before = toCustomerDto(customer);
      customer.deletedAt = null;
      customer.updatedAt = new Date();
      audit(draft, "CUSTOMER_RESTORED", id, before, toCustomerDto(customer));
      return customer;
    });
    return response(result);
  },
};
