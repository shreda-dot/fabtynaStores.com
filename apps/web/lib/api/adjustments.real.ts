import type { CreateAdjustmentDto, StockAdjustmentDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type { AdjustmentDetailDto, AdjustmentsApi } from "./adjustments.api";

type AdjustmentPage = { items: StockAdjustmentDto[]; nextCursor: string | null };

export const adjustmentsRealApi: AdjustmentsApi = {
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
