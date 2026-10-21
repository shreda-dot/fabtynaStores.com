import type { CreatePurchaseDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  PurchaseAmendResultDto,
  PurchaseDetailDto,
  PurchaseListOptions,
  PurchaseListPage,
  PurchasesApi,
} from "./purchases.api";

function listQuery(options: PurchaseListOptions): string {
  const query = new URLSearchParams();
  if (options.from) query.set("from", options.from);
  if (options.to) query.set("to", options.to);
  if (options.status) query.set("status", options.status);
  if (options.supplierId) query.set("supplierId", options.supplierId);
  if (options.unpaid) query.set("unpaid", "true");
  if (options.overdue) query.set("overdue", "true");
  if (options.search?.trim()) query.set("q", options.search.trim());
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  return `?${query.toString()}`;
}

type WirePurchaseDetail = Omit<PurchaseDetailDto, "movements"> & {
  movements?: PurchaseDetailDto["movements"];
};

async function fetchDetail(id: string): Promise<PurchaseDetailDto> {
  const wire = await requestJson<WirePurchaseDetail>(`/purchases/${encodeURIComponent(id)}`);
  return { ...wire, movements: wire.movements ?? [] };
}

export const purchasesRealApi: PurchasesApi = {
  async list() {
    return (await purchasesRealApi.listPage({})).items;
  },
  async listPage(options) {
    return requestJson<PurchaseListPage>(`/purchases${listQuery(options)}`);
  },
  getById: fetchDetail,
  async create(input: CreatePurchaseDto, idempotencyKey) {
    const created = await requestJson<{ id: string }>("/purchases", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
    return fetchDetail(created.id);
  },
  async update(id, input: CreatePurchaseDto, idempotencyKey): Promise<PurchaseAmendResultDto> {
    const result = await requestJson<{ purchase: { id: string }; voidedPurchaseId: string }>(
      `/purchases/${encodeURIComponent(id)}`,
      { method: "PUT", body: input, idempotencyKey },
    );
    return {
      ...(await fetchDetail(result.purchase.id)),
      voidedPurchaseId: result.voidedPurchaseId,
    };
  },
  async void(id, idempotencyKey) {
    await requestJson<unknown>(`/purchases/${encodeURIComponent(id)}/void`, {
      method: "POST",
      idempotencyKey,
    });
    return fetchDetail(id);
  },
  async recordPayment(id, amountKobo, paidAt, method, accountId, note, idempotencyKey) {
    await requestJson<unknown>(`/purchases/${encodeURIComponent(id)}/payments`, {
      method: "POST",
      body: {
        amountKobo,
        paidAt,
        method,
        accountId,
        ...(note === undefined ? {} : { note }),
      },
      idempotencyKey,
    });
    return fetchDetail(id);
  },
  async reversePayment(id, paymentId, reason, idempotencyKey) {
    await requestJson<unknown>(
      `/purchases/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/reverse`,
      { method: "POST", body: { reason }, idempotencyKey },
    );
    return fetchDetail(id);
  },
};
