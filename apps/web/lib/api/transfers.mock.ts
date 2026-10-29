import {
  buildTransfer,
  createTransferDtoSchema,
  fromAuditLogDto,
  getLagosBusinessDate,
  toAuditLogDto,
  toStockMovementDto,
  toStockTransferDto,
  toStockTransferLegDto,
  toStockTransferLineDto,
} from "@fabtyna/shared";
import type { TransfersApi, TransferDetailDto } from "./transfers.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  entityId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "StockTransfer",
        entityId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function buildTransferDetail(
  store: ReturnType<typeof readMockStore>,
  transferId: string,
): TransferDetailDto {
  const transfer = store.stockTransfers.find((t) => t.id === transferId);
  if (!transfer) throw new Error("Transfer not found.");
  const productById = new Map(store.products.map((p) => [p.id, p.name]));
  const lines = store.stockTransferLines
    .filter((l) => l.transferId === transferId)
    .map((l) => ({
      ...toStockTransferLineDto(l),
      productName: productById.get(l.productId) ?? l.productId,
    }));
  const lineIds = new Set(lines.map((l) => l.id));
  const legs = store.stockTransferLegs
    .filter((l) => lineIds.has(l.transferLineId))
    .map(toStockTransferLegDto);
  const legIds = new Set(legs.map((l) => l.id));
  const movements = store.stockMovements
    .filter(
      (m) => m.transferLegId !== null && legIds.has(m.transferLegId),
    )
    .map(toStockMovementDto);
  return jsonClone({
    ...toStockTransferDto(transfer),
    lines,
    legs,
    movements,
  });
}

export const transfersMockApi: TransfersApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const items = store.stockTransfers
      .slice()
      .sort((a, b) => b.transferredAt.getTime() - a.transferredAt.getTime())
      .map(toStockTransferDto);
    return jsonClone(items);
  },

  async listPage(options) {
    await delay();
    const store = readMockStore();
    const from = options.from ?? null;
    const to = options.to ?? null;
    const all = store.stockTransfers
      .slice()
      .sort((a, b) => b.transferredAt.getTime() - a.transferredAt.getTime())
      .map(toStockTransferDto)
      .filter((transfer) => {
        const date = getLagosBusinessDate(new Date(transfer.transferredAt));
        return (from === null || date >= from) && (to === null || date <= to);
      });
    const limit = options.limit ?? 50;
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const items = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
    return jsonClone({ items, nextCursor, from, to });
  },

  async getById(id) {
    await delay();
    const store = readMockStore();
    return buildTransferDetail(store, id);
  },

  async create(input) {
    await delay();
    const data = createTransferDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const built = buildTransfer(
        {
          createdById: "admin",
          from: data.from,
          to: data.to,
          reason: data.reason,
          reference: data.reference?.trim() !== "" ? data.reference! : `TRF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          transferredAt: new Date(data.transferredAt),
          lines: data.lines.map((line) => ({
            productId: line.productId,
            quantityUnits: line.quantityUnits,
          })),
        },
        draft.products,
        draft.stockMovements,
        newId,
      );

      draft.stockTransfers.push(built.transfer);
      draft.stockTransferLines.push(...built.transferLines);
      draft.stockTransferLegs.push(...built.transferLegs);
      draft.stockMovements.push(...built.movements);
      audit(
        draft,
        "TRANSFER_CREATED",
        built.transfer.id,
        null,
        toStockTransferDto(built.transfer),
      );
      return built.transfer;
    });

    const store = readMockStore();
    return buildTransferDetail(store, result.id);
  },
};