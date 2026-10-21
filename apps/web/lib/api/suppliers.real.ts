import type { CreateSupplierDto, SupplierDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  CursorPage,
  SupplierDetailDto,
  SupplierListItemDto,
  SupplierListOptions,
  SupplierStatementDto,
  SupplierStatementOptions,
  SuppliersApi,
} from "./suppliers.api";

function listQuery(options: SupplierListOptions): string {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("q", options.search.trim());
  query.set("active", options.includeDeleted ? "false" : "true");
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.withBalance !== undefined) {
    query.set("withBalance", String(options.withBalance));
  }
  return `?${query.toString()}`;
}

function statementQuery(options: SupplierStatementOptions): string {
  const query = new URLSearchParams();
  if (options.from) query.set("from", options.from);
  if (options.to) query.set("to", options.to);
  if (options.cursor) query.set("cursor", options.cursor);
  query.set("limit", String(options.limit ?? 50));
  return `?${query.toString()}`;
}

type SupplierProfileResponse = Omit<SupplierDetailDto, "balanceOwedKobo"> & {
  balanceKobo: string;
};

export const suppliersRealApi: SuppliersApi = {
  async list(options = {}) {
    return (await this.listPage(options)).items;
  },
  async listPage(options = {}) {
    return requestJson<CursorPage<SupplierListItemDto>>(`/suppliers${listQuery(options)}`);
  },
  async getById(id) {
    const { balanceKobo, ...profile } =
      await requestJson<SupplierProfileResponse>(
        `/suppliers/${encodeURIComponent(id)}`,
      );
    return { ...profile, balanceOwedKobo: balanceKobo };
  },
  async getStatement(id, options = {}) {
    return requestJson<SupplierStatementDto>(
      `/suppliers/${encodeURIComponent(id)}/statement${statementQuery(options)}`,
    );
  },
  async create(input: CreateSupplierDto, idempotencyKey) {
    return requestJson<SupplierDto>("/suppliers", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
  },
  async update(id, input, idempotencyKey) {
    return requestJson<SupplierDto>(`/suppliers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
      idempotencyKey,
    });
  },
  async softDelete(id, idempotencyKey) {
    return requestJson<SupplierDto>(
      `/suppliers/${encodeURIComponent(id)}/deactivate`,
      { method: "POST", idempotencyKey },
    );
  },
  async restore(id, idempotencyKey) {
    return requestJson<SupplierDto>(
      `/suppliers/${encodeURIComponent(id)}/reactivate`,
      { method: "POST", idempotencyKey },
    );
  },
};
