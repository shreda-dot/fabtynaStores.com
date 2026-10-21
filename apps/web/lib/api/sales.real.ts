import type { CreateSaleDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  SaleAmendResultDto,
  SaleDetailDto,
  SaleListOptions,
  SaleListPage,
  SalesApi,
} from "./sales.api";

function listQuery(options: SaleListOptions): string {
  const query = new URLSearchParams();
  if (options.from) query.set("from", options.from);
  if (options.to) query.set("to", options.to);
  if (options.status) query.set("status", options.status);
  if (options.channel) query.set("channel", options.channel);
  if (options.customerId) query.set("customerId", options.customerId);
  if (options.unpaid) query.set("unpaid", "true");
  if (options.search?.trim()) query.set("q", options.search.trim());
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  return `?${query.toString()}`;
}

type WireSaleDetail = Omit<SaleDetailDto, "movements"> & {
  movements?: SaleDetailDto["movements"];
};

function mapDetail(wire: WireSaleDetail): SaleDetailDto {
  // The API does not send stock movements; no screen needs them.
  return { ...wire, movements: wire.movements ?? [] };
}

async function fetchDetail(id: string): Promise<SaleDetailDto> {
  return mapDetail(await requestJson<WireSaleDetail>(`/sales/${encodeURIComponent(id)}`));
}

export const salesRealApi: SalesApi = {
  async list() {
    return (await salesRealApi.listPage({})).items;
  },
  async listPage(options) {
    return requestJson<SaleListPage>(`/sales${listQuery(options)}`);
  },
  getById: fetchDetail,
  async create(input: CreateSaleDto, idempotencyKey) {
    const created = await requestJson<{ id: string }>("/sales", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
    return fetchDetail(created.id);
  },
  async update(id, input: CreateSaleDto, idempotencyKey): Promise<SaleAmendResultDto> {
    // The API generates a NEW reference on amend and ignores a client one.
    const result = await requestJson<{ sale: { id: string }; voidedSaleId: string }>(
      `/sales/${encodeURIComponent(id)}`,
      { method: "PUT", body: input, idempotencyKey },
    );
    return { ...(await fetchDetail(result.sale.id)), voidedSaleId: result.voidedSaleId };
  },
  async void(id, idempotencyKey) {
    await requestJson<unknown>(`/sales/${encodeURIComponent(id)}/void`, {
      method: "POST",
      idempotencyKey,
    });
    return fetchDetail(id);
  },
  async recordPayment(id, amountKobo, paidAt, accountId, idempotencyKey) {
    await requestJson<unknown>(`/sales/${encodeURIComponent(id)}/payments`, {
      method: "POST",
      body: { amountKobo, accountId, paidAt },
      idempotencyKey,
    });
    return fetchDetail(id);
  },
  async reversePayment(id, paymentId, reason, idempotencyKey) {
    await requestJson<unknown>(
      `/sales/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/reverse`,
      { method: "POST", body: { reason }, idempotencyKey },
    );
    return fetchDetail(id);
  },
};
