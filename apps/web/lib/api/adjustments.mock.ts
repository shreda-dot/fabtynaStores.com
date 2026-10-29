import {
  buildAdjustment,
  createAdjustmentDtoSchema,
  fromAuditLogDto,
  getLagosBusinessDate,
  toAuditLogDto,
  toStockAdjustmentDto,
  toStockAdjustmentLineDto,
  toStockMovementDto,
  voidAdjustment,
} from "@fabtyna/shared";
import type { AdjustmentsApi, AdjustmentDetailDto } from "./adjustments.api";
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
        entityType: "StockAdjustment",
        entityId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function buildAdjustmentDetail(
  store: ReturnType<typeof readMockStore>,
  adjustmentId: string,
): AdjustmentDetailDto {
  const adjustment = store.stockAdjustments.find((a) => a.id === adjustmentId);
  if (!adjustment) throw new Error("Adjustment not found.");
  const productById = new Map(store.products.map((p) => [p.id, p.name]));
  const lines = store.stockAdjustmentLines
    .filter((l) => l.adjustmentId === adjustmentId)
    .map((l) => ({
      ...toStockAdjustmentLineDto(l),
      productName: productById.get(l.productId) ?? l.productId,
    }));
  const lineIds = new Set(lines.map((l) => l.id));
  const movements = store.stockMovements
    .filter(
      (m) =>
        m.type === "ADJUSTMENT" &&
        m.adjustmentLineId !== null &&
        lineIds.has(m.adjustmentLineId),
    )
    .map(toStockMovementDto);
  return jsonClone({
    ...toStockAdjustmentDto(adjustment),
    lines,
    movements,
  });
}

export const adjustmentsMockApi: AdjustmentsApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const items = store.stockAdjustments
      .slice()
      .sort((a, b) => b.adjustedAt.getTime() - a.adjustedAt.getTime())
      .map(toStockAdjustmentDto);
    return jsonClone(items);
  },

  async listPage(options) {
    await delay();
    const store = readMockStore();
    const from = options.from ?? null;
    const to = options.to ?? null;
    const all = store.stockAdjustments
      .slice()
      .sort((a, b) => b.adjustedAt.getTime() - a.adjustedAt.getTime())
      .map(toStockAdjustmentDto)
      .filter((adjustment) => {
        const date = getLagosBusinessDate(new Date(adjustment.adjustedAt));
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
    return buildAdjustmentDetail(store, id);
  },

  async create(input) {
    await delay();
    const data = createAdjustmentDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const built = buildAdjustment(
        {
          createdById: "admin",
          reason: data.reason,
          adjustedAt: new Date(data.adjustedAt),
          lines: data.lines.map((line) => ({
            productId: line.productId,
            location: line.location,
            quantityDeltaUnits: line.quantityDeltaUnits,
            unitCostKobo: line.unitCostKobo != null ? BigInt(line.unitCostKobo) : null,
          })),
        },
        draft.products,
        draft.stockMovements,
        newId,
      );

      draft.stockAdjustments.push(built.adjustment);
      draft.stockAdjustmentLines.push(...built.adjustmentLines);
      draft.stockMovements.push(...built.movements);
      for (const update of built.productUpdates) {
        const product = draft.products.find((p) => p.id === update.id);
        if (product) product.averageCostKobo = update.averageCostKobo;
      }
      audit(
        draft,
        "ADJUSTMENT_CREATED",
        built.adjustment.id,
        null,
        toStockAdjustmentDto(built.adjustment),
      );
      return built.adjustment;
    });

    const store = readMockStore();
    return buildAdjustmentDetail(store, result.id);
  },

  async void(id) {
    await delay();
    const voidedAt = new Date();
    transactMockStore((draft) => {
      const voided = voidAdjustment(
        id,
        voidedAt,
        draft.stockAdjustments,
        draft.stockAdjustmentLines,
        draft.stockMovements,
        newId,
      );

      const adjustment = draft.stockAdjustments.find((a) => a.id === id);
      if (adjustment) {
        adjustment.status = "VOIDED";
      }
      draft.stockMovements.push(...voided.reversalMovements);
      for (const update of voided.productUpdates) {
        const product = draft.products.find((p) => p.id === update.id);
        if (product) product.averageCostKobo = update.averageCostKobo;
      }
      audit(
        draft,
        "ADJUSTMENT_VOIDED",
        id,
        null,
        adjustment ? toStockAdjustmentDto(adjustment) : null,
      );
      return adjustment;
    });

    const store = readMockStore();
    return buildAdjustmentDetail(store, id);
  },
};