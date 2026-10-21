import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import {
  buildTransfer,
  getLagosBusinessDate,
  toStockTransferDto,
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
import { getTransferDetail, listTransfers } from "./transfers.queries.js";
import { insertTransfer, nextTransferSequence } from "./stock.repository.js";
import type { CreateTransferBody, ListTransfersQuery } from "./stock.schemas.js";

export const CREATE_TRANSFER_ROUTE = "POST /transfers";
const LOCATIONS: readonly StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

export interface TransfersServiceOptions {
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

function transferReference(at: Date, sequence: bigint): string {
  const day = getLagosBusinessDate(at).replaceAll("-", "");
  return `T-${day}-${sequence.toString().padStart(6, "0")}`;
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

export function createTransfersService(options: TransfersServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const { runWrite, withIdempotency } = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  async function create(dto: CreateTransferBody, actor: Actor, idempotencyKey: string | null): Promise<WriteResponse> {
    const transferredAt = dto.transferredAt === undefined ? now() : new Date(dto.transferredAt);
    assertNotInFuture(transferredAt, now(), "transferredAt", "The transfer date");
    const route = CREATE_TRANSFER_ROUTE;

    return runWrite(route, { lines: dto.lines.length }, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const productIds = dto.lines.map((line) => line.productId);
        const products = await lockProducts(ctx, productIds);
        const productById = new Map(products.map((product) => [product.id, product]));
        for (const productId of new Set(productIds)) {
          const product = productById.get(productId);
          if (product === undefined) {
            throw validationError("That product does not exist.", { field: "lines.productId", productId });
          }
          if (product.deletedAt !== null) {
            throw businessRuleError(`Product '${product.name}' is deactivated and cannot be transferred.`, {
              productId,
              productName: product.name,
            });
          }
        }

        const keys = [...new Set(productIds)].flatMap((productId) =>
          [...new Set([dto.from, dto.to])].map((location) => ({ productId, location })),
        );
        const stock = await lockStockBalances(ctx, keys);
        const requestedByProduct = new Map<string, number>();
        for (const line of dto.lines) {
          requestedByProduct.set(line.productId, (requestedByProduct.get(line.productId) ?? 0) + line.quantityUnits);
        }
        for (const [productId, requested] of [...requestedByProduct].sort(([left], [right]) => left.localeCompare(right))) {
          const product = productById.get(productId)!;
          const available = stock.get(stockKey(productId, dto.from)) ?? 0;
          if (requested > available) throw insufficientStock(product, dto.from, available, requested);
        }

        const built = buildTransfer(
          {
            createdById: actor.id,
            from: dto.from,
            to: dto.to,
            reason: dto.reason ?? null,
            reference: transferReference(transferredAt, await nextTransferSequence(ctx)),
            transferredAt,
            lines: dto.lines,
          },
          products,
          syntheticMovements(products, stock),
          randomUUID,
        );
        await insertTransfer(ctx, {
          transfer: built.transfer,
          lines: built.transferLines,
          legs: built.transferLegs,
          movements: built.movements,
          actorId: actor.id,
          audit: {
            actorId: actor.id,
            action: "TRANSFER_CREATED",
            entityId: built.transfer.id,
            beforeData: undefined,
            afterData: {
              reference: built.transfer.reference!,
              from: built.transfer.from,
              to: built.transfer.to,
              transferredAt: built.transfer.transferredAt.toISOString(),
              lineCount: built.transferLines.length,
            },
            metadata: { idempotencyKey, actorEmail: actor.email },
          },
        });
        return { status: 201, body: toStockTransferDto(built.transfer) };
      }),
    );
  }

  return {
    create,
    async list(query: ListTransfersQuery) {
      return listTransfers(prisma, query, now(), maxDateRangeDays);
    },
    async get(id: string) {
      return getTransferDetail(prisma, id);
    },
  };
}

export type TransfersService = ReturnType<typeof createTransfersService>;
