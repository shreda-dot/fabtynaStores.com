import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import {
  buildAdjustment,
  toStockAdjustmentDto,
  voidAdjustment,
  type Product,
  type StockLocation,
  type StockMovement,
} from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { lockProducts, lockStockBalances, stockKey } from "../../lib/locks.js";
import { createWriteRunner, type TxContext, type WriteResponse } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { assertNotInFuture } from "../sales/sales.validation.js";
import { getAdjustmentDetail, listAdjustments } from "./adjustments.queries.js";
import {
  insertAdjustment,
  loadAdjustmentLines,
  loadProductMovements,
  lockAdjustment,
  updateProductCosts,
  voidAdjustmentWrites,
} from "./stock.repository.js";
import type { CreateAdjustmentBody, ListAdjustmentsQuery } from "./stock.schemas.js";

const ADJUSTMENT_ROUTE = "POST /adjustments";
const LOCATIONS: readonly StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export interface AdjustmentsServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

function syntheticMovements(products: readonly Product[], stock: ReadonlyMap<string, number>): StockMovement[] {
  const epoch = new Date(0);
  return products.flatMap((product) =>
    LOCATIONS.flatMap((location) => {
      const units = stock.get(stockKey(product.id, location)) ?? 0;
      return units === 0
        ? []
        : [{
            id: `locked-${product.id}-${location}`,
            productId: product.id,
            location,
            type: "PURCHASE" as const,
            quantityUnits: units,
            unitCostKobo: product.averageCostKobo,
            purchaseLineId: null,
            saleLineId: null,
            transferLegId: null,
            adjustmentLineId: null,
            returnLineId: null,
            reversesEntryId: null,
            occurredAt: epoch,
            createdAt: epoch,
          }];
    }),
  );
}

function insufficientStock(
  product: Product,
  location: StockLocation,
  available: number,
  requested: number,
): AppError {
  return new AppError(
    409,
    "INSUFFICIENT_STOCK",
    `Not enough stock for '${product.name}' at ${location}: ${available} available, ${requested} requested.`,
    { productId: product.id, productName: product.name, location, availableUnits: available, requestedUnits: requested },
  );
}

function alreadyVoided(id: string): AppError {
  return businessRuleError("This stock adjustment has already been voided.", { adjustmentId: id });
}

export function createAdjustmentsService(options: AdjustmentsServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const { runWrite, withIdempotency } = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  async function create(dto: CreateAdjustmentBody, actor: Actor, idempotencyKey: string | null): Promise<WriteResponse> {
    const adjustedAt = dto.adjustedAt === undefined ? now() : new Date(dto.adjustedAt);
    assertNotInFuture(adjustedAt, now(), "adjustedAt", "The adjustment date");
    return runWrite(ADJUSTMENT_ROUTE, { lines: dto.lines.length }, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route: ADJUSTMENT_ROUTE, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const productIds = dto.lines.map((line) => line.productId);
        const products = await lockProducts(ctx, productIds);
        const productById = new Map(products.map((product) => [product.id, product]));
        for (const productId of new Set(productIds)) {
          const product = productById.get(productId);
          if (product === undefined) {
            throw validationError("That product does not exist.", { field: "lines.productId", productId });
          }
          if (product.deletedAt !== null) {
            throw businessRuleError(`Product '${product.name}' is deactivated and cannot be adjusted.`, {
              productId,
              productName: product.name,
            });
          }
        }

        const keys = [...new Set(productIds)].flatMap((productId) =>
          LOCATIONS.map((location) => ({ productId, location })),
        );
        const stock = await lockStockBalances(ctx, keys);
        const requestedByKey = new Map<string, number>();
        for (const line of dto.lines) {
          if (line.quantityDeltaUnits < 0) {
            const key = stockKey(line.productId, line.location);
            requestedByKey.set(key, (requestedByKey.get(key) ?? 0) - line.quantityDeltaUnits);
          }
        }
        for (const [key, requested] of [...requestedByKey].sort(([left], [right]) => left.localeCompare(right))) {
          const [productId, location] = key.split(":") as [string, StockLocation];
          const product = productById.get(productId)!;
          const available = stock.get(key) ?? 0;
          if (requested > available) throw insufficientStock(product, location, available, requested);
        }

        const built = buildAdjustment(
          {
            createdById: actor.id,
            reason: dto.reason,
            adjustedAt,
            lines: dto.lines.map((line) => ({
              productId: line.productId,
              location: line.location,
              quantityDeltaUnits: line.quantityDeltaUnits,
              unitCostKobo: line.unitCostKobo === undefined ? null : BigInt(line.unitCostKobo),
              reason: line.reason ?? null,
            })),
          },
          products,
          syntheticMovements(products, stock),
          randomUUID,
        );
        await insertAdjustment(ctx, {
          adjustment: built.adjustment,
          lines: built.adjustmentLines,
          movements: built.movements,
          productUpdates: built.productUpdates,
          actorId: actor.id,
          audit: {
            actorId: actor.id,
            action: "ADJUSTMENT_CREATED",
            entityId: built.adjustment.id,
            afterData: {
              reason: built.adjustment.reason,
              adjustedAt: built.adjustment.adjustedAt.toISOString(),
              status: built.adjustment.status,
              lineCount: built.adjustmentLines.length,
            },
            metadata: { idempotencyKey, actorEmail: actor.email },
          },
        });
        return { status: 201, body: toStockAdjustmentDto(built.adjustment) };
      }),
    );
  }

  async function voidOne(id: string, actor: Actor, idempotencyKey: string | null): Promise<WriteResponse> {
    const route = `POST /adjustments/${id}/void`;
    return runWrite(route, {}, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route, key: idempotencyKey, requestHash: hashRequestBody({}) }, async () => {
        const initial = await ctx.tx.stockAdjustment.findUnique({
          where: { id },
          include: { lines: { orderBy: { id: "asc" } } },
        });
        if (initial === null) throw new AppError(404, "NOT_FOUND", "Stock adjustment not found.", { id });
        if (initial.status === "VOIDED") throw alreadyVoided(id);

        const productIds = initial.lines.map((line) => line.productId);
        const products = await lockProducts(ctx, productIds);
        const productById = new Map(products.map((product) => [product.id, product]));
        const keys = initial.lines.map((line) => ({ productId: line.productId, location: line.location }));
        const stock = await lockStockBalances(ctx, keys);
        const lockedAdjustment = await lockAdjustment(ctx, id);
        if (lockedAdjustment === null) throw new AppError(404, "NOT_FOUND", "Stock adjustment not found.", { id });
        if (lockedAdjustment.status === "VOIDED") throw alreadyVoided(id);
        const lines = await loadAdjustmentLines(ctx, id);
        const movements = await loadProductMovements(ctx, productIds);

        const originalLineIds = new Set(lines.map((line) => line.id));
        const originalMovements = movements.filter(
          (movement) =>
            movement.type === "ADJUSTMENT" &&
            movement.adjustmentLineId !== null &&
            originalLineIds.has(movement.adjustmentLineId) &&
            movement.reversesEntryId === null,
        );
        const reverseUnits = new Map<string, number>();
        for (const movement of originalMovements) {
          const key = stockKey(movement.productId, movement.location);
          reverseUnits.set(key, (reverseUnits.get(key) ?? 0) + movement.quantityUnits);
        }
        for (const [key, reversalDelta] of reverseUnits) {
          const [productId, location] = key.split(":") as [string, StockLocation];
          const available = stock.get(key) ?? 0;
          if (available - reversalDelta < 0) {
            const product = productById.get(productId)!;
            throw insufficientStock(product, location, available, reversalDelta);
          }
        }

        const result = voidAdjustment(id, now(), [lockedAdjustment], lines, movements, randomUUID);
        await voidAdjustmentWrites(ctx, {
          adjustmentId: id,
          reversals: result.reversalMovements,
          productUpdates: result.productUpdates,
          audit: {
            actorId: actor.id,
            action: "ADJUSTMENT_VOIDED",
            entityId: id,
            beforeData: {
              id,
              status: lockedAdjustment.status,
              reason: lockedAdjustment.reason,
              adjustedAt: lockedAdjustment.adjustedAt.toISOString(),
            },
            afterData: {
              id,
              status: "VOIDED",
              reversedMovementCount: result.reversalMovements.length,
            },
            metadata: { idempotencyKey, actorEmail: actor.email },
          },
        });
        return {
          status: 200,
          body: toStockAdjustmentDto({ ...lockedAdjustment, status: "VOIDED" }),
        };
      }),
    );
  }

  return {
    create,
    void: voidOne,
    async list(query: ListAdjustmentsQuery) {
      return listAdjustments(prisma, query, now(), maxDateRangeDays);
    },
    async get(id: string) {
      return getAdjustmentDetail(prisma, id);
    },
  };
}

export type AdjustmentsService = ReturnType<typeof createAdjustmentsService>;
