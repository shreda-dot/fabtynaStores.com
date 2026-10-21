import {
  createCustomerDtoSchema,
  fromAuditLogDto,
  getLagosBusinessDate,
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
  CustomerStatementOptions,
} from "./customers.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
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

function customerOutstandingDebtKobo(
  store: ReturnType<typeof readMockStore>,
  customerId: string,
): bigint {
  return store.sales.reduce((sum, sale) => {
    if (sale.customerId !== customerId || sale.status === "VOIDED") return sum;
    const owed = sale.totalKobo - sale.paidKobo;
    return owed > 0n ? sum + owed : sum;
  }, 0n);
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
    const store = readMockStore();
    const search = options.search?.trim().toLocaleLowerCase() ?? "";
    const rows = store.customers.filter((customer) => {
      if (!options.includeDeleted && customer.deletedAt !== null) return false;
      if (options.includeDeleted && customer.deletedAt === null) return false;
      const balance = store.customerLedgerEntries
        .filter((entry) => entry.customerId === customer.id)
        .reduce((sum, entry) => sum + entry.amountKobo, 0n);
      if (options.withBalance === true && balance <= 0n) return false;
      if (options.withBalance === false && balance > 0n) return false;
      if (options.type && customer.type !== options.type) return false;
      if (!search) return true;
      return (
        customer.name.toLocaleLowerCase().includes(search) ||
        customer.phone?.toLocaleLowerCase().includes(search) === true ||
        customer.email?.toLocaleLowerCase().includes(search) === true
      );
    });
    return jsonClone(
      rows.map((customer) => ({
        ...toCustomerDto(customer),
        active: customer.deletedAt === null,
        balanceKobo: store.customerLedgerEntries
          .filter((entry) => entry.customerId === customer.id)
          .reduce((sum, entry) => sum + entry.amountKobo, 0n)
          .toString(),
      })),
    );
  },
  async listPage(options: CustomerListOptions = {}) {
    const items = await customersMockApi.list(options);
    return jsonClone({ items, nextCursor: null });
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
    const today = getLagosBusinessDate();
    const dayNumber = (value: string) => {
      const [year, month, day] = value.split("-").map(Number);
      return Date.UTC(year, month - 1, day);
    };
    const detail: CustomerDetailDto = {
      customer: {
        ...toCustomerDto(customer),
        active: customer.deletedAt === null,
      },
      balanceOwedKobo: balanceOwedKobo.toString(),
      unpaidSales: sales
        .filter((sale) => sale.status !== "VOIDED" && sale.totalKobo > sale.paidKobo)
        .map((sale) => ({
          id: sale.id,
          reference: sale.reference,
          soldAt: sale.soldAt.toISOString(),
          totalKobo: sale.totalKobo.toString(),
          paidKobo: sale.paidKobo.toString(),
          balanceDueKobo: (sale.totalKobo - sale.paidKobo).toString(),
          daysOutstanding: Math.max(
            0,
            (dayNumber(today) - dayNumber(getLagosBusinessDate(sale.soldAt))) /
              86_400_000,
          ),
          linesSummary: store.saleLines
            .filter((line) => line.saleId === sale.id)
            .map((line) => ({
              productName:
                store.products.find((product) => product.id === line.productId)?.name ??
                line.productId,
              quantity: String(line.quantity),
              unit: line.unit,
            })),
        })),
      recentSales: sales.slice(0, 10).map((sale) => {
        const dto = toSaleDto(sale);
        return {
          id: dto.id,
          reference: dto.reference,
          status: dto.status,
          totalKobo: dto.totalKobo,
          paidKobo: dto.paidKobo,
          soldAt: dto.soldAt,
        };
      }),
    };
    return jsonClone(detail);
  },

  async getStatement(id, options: CustomerStatementOptions = {}) {
    await delay();
    const store = readMockStore();
    const customer = findCustomer(store.customers, id);
    const entries = store.customerLedgerEntries
      .filter((entry) => entry.customerId === id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let runningBalance = 0n;
    const mapped = entries.map((entry) => {
      runningBalance += entry.amountKobo;
      const dto = toCustomerLedgerEntryDto(entry);
      const reversedBy = entries.find((candidate) => candidate.reversesEntryId === entry.id);
      return {
        ...dto,
        sourceDescription:
          entry.saleId === null ? entry.note ?? entry.type : "Sale",
        isReversal: entry.reversesEntryId !== null,
        reversesEntryId: entry.reversesEntryId,
        reversedByEntryId: reversedBy?.id ?? null,
        runningBalanceKobo: runningBalance.toString(),
      };
    });
    return jsonClone({
      party: { id: customer.id, name: customer.name },
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
      const outstandingDebtKobo = customerOutstandingDebtKobo(draft, id);
      if (outstandingDebtKobo > 0n) {
        throw new Error(
          "Customer cannot be deleted while they still owe an unpaid balance.",
        );
      }
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
