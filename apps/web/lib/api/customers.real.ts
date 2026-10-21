import type { CreateCustomerDto, CustomerDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  CursorPage,
  CustomerDetailDto,
  CustomerListItemDto,
  CustomerListOptions,
  CustomerStatementDto,
  CustomerStatementOptions,
  CustomersApi,
} from "./customers.api";

function listQuery(options: CustomerListOptions): string {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("q", options.search.trim());
  query.set("active", options.includeDeleted ? "false" : "true");
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.withBalance !== undefined) {
    query.set("withBalance", String(options.withBalance));
  }
  if (options.type) query.set("type", options.type);
  return `?${query.toString()}`;
}

function statementQuery(options: CustomerStatementOptions): string {
  const query = new URLSearchParams();
  if (options.from) query.set("from", options.from);
  if (options.to) query.set("to", options.to);
  if (options.cursor) query.set("cursor", options.cursor);
  query.set("limit", String(options.limit ?? 50));
  return `?${query.toString()}`;
}

type CustomerProfileResponse = Omit<CustomerDetailDto, "balanceOwedKobo"> & {
  balanceKobo: string;
};

export const customersRealApi: CustomersApi = {
  async list(options = {}) {
    return (await this.listPage(options)).items;
  },
  async listPage(options = {}) {
    return requestJson<CursorPage<CustomerListItemDto>>(`/customers${listQuery(options)}`);
  },
  async getById(id) {
    const { balanceKobo, ...profile } = await requestJson<CustomerProfileResponse>(
      `/customers/${encodeURIComponent(id)}`,
    );
    return {
      ...profile,
      balanceOwedKobo: balanceKobo,
    };
  },
  async getStatement(id, options = {}) {
    return requestJson<CustomerStatementDto>(
      `/customers/${encodeURIComponent(id)}/statement${statementQuery(options)}`,
    );
  },
  async create(input: CreateCustomerDto, idempotencyKey) {
    return requestJson<CustomerDto>("/customers", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
  },
  async update(id, input, idempotencyKey) {
    return requestJson<CustomerDto>(`/customers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
      idempotencyKey,
    });
  },
  async softDelete(id, idempotencyKey) {
    return requestJson<CustomerDto>(
      `/customers/${encodeURIComponent(id)}/deactivate`,
      { method: "POST", idempotencyKey },
    );
  },
  async restore(id, idempotencyKey) {
    return requestJson<CustomerDto>(
      `/customers/${encodeURIComponent(id)}/reactivate`,
      { method: "POST", idempotencyKey },
    );
  },
};
