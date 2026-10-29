import type { CreateAdjustmentDto, StockAdjustmentDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  AdjustmentDetailDto,
  AdjustmentListPage,
  AdjustmentsApi,
} from "./adjustments.api";

type AdjustmentPage = {
  items: StockAdjustmentDto[];
  nextCursor: string | null;
  from?: string | null;
  to?: string | null;
};

export const adjustmentsRealApi: AdjustmentsApi = {
  // Without dates the server returns only today's adjustments.
  async list() {
    const items: StockAdjustmentDto[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "200" });
      if (cursor) query.set("cursor", cursor);
      const page = await requestJson<AdjustmentPage>(`/adjustments?${query.toString()}`);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  },

  async listPage(options): Promise<AdjustmentListPage> {
    const query = new URLSearchParams();
    if (options.from) query.set("from", options.from);
    if (options.to) query.set("to", options.to);
    query.set("limit", String(options.limit ?? 50));
    if (options.cursor) query.set("cursor", options.cursor);
    const page = await requestJson<AdjustmentPage>(`/adjustments?${query.toString()}`);
    return {
      items: page.items,
      nextCursor: page.nextCursor ?? null,
      from: page.from ?? null,
      to: page.to ?? null,
    };
  },

  getById(id) {
    return requestJson<AdjustmentDetailDto>(`/adjustments/${encodeURIComponent(id)}`);
  },

  async create(input: CreateAdjustmentDto, idempotencyKey) {
    const { id } = await requestJson<{ id: string }>("/adjustments", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
    return adjustmentsRealApi.getById(id);
  },

  async void(id, idempotencyKey) {
    await requestJson<unknown>(`/adjustments/${encodeURIComponent(id)}/void`, {
      method: "POST",
      idempotencyKey,
    });
    return adjustmentsRealApi.getById(id);
  },
};