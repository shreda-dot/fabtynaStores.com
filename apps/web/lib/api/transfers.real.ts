import type { CreateTransferDto, StockTransferDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type { TransferDetailDto, TransferListPage, TransfersApi } from "./transfers.api";

type TransferPage = {
  items: StockTransferDto[];
  nextCursor: string | null;
  from?: string | null;
  to?: string | null;
};

export const transfersRealApi: TransfersApi = {
  // Without dates the server returns only today's transfers.
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

  async listPage(options): Promise<TransferListPage> {
    const query = new URLSearchParams();
    if (options.from) query.set("from", options.from);
    if (options.to) query.set("to", options.to);
    query.set("limit", String(options.limit ?? 50));
    if (options.cursor) query.set("cursor", options.cursor);
    const page = await requestJson<TransferPage>(`/transfers?${query.toString()}`);
    return {
      items: page.items,
      nextCursor: page.nextCursor ?? null,
      from: page.from ?? null,
      to: page.to ?? null,
    };
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