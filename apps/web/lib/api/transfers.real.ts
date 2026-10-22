import type { CreateTransferDto, StockTransferDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type { TransferDetailDto, TransfersApi } from "./transfers.api";

type TransferPage = { items: StockTransferDto[]; nextCursor: string | null };

export const transfersRealApi: TransfersApi = {
  async list() {
    const items: StockTransferDto[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "200" });
      if (cursor) query.set("cursor", cursor);
      const page = await requestJson<TransferPage>(`/transfers?${query.toString()}`);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  },

  getById(id) {
    return requestJson<TransferDetailDto>(`/transfers/${encodeURIComponent(id)}`);
  },

  async create(input: CreateTransferDto, idempotencyKey) {
    const { id } = await requestJson<{ id: string }>("/transfers", {
      method: "POST",
      body: {
        from: input.from,
        to: input.to,
        reason: input.reason,
        transferredAt: input.transferredAt,
        lines: input.lines,
      },
      idempotencyKey,
    });
    return transfersRealApi.getById(id);
  },
};
