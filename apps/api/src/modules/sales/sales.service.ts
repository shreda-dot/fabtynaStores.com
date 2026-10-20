import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { recordSale, toSaleDto, type Product, type StockMovement } from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { claimIdempotencyKey, hashRequestBody, storeIdempotentResponse } from "../../lib/idempotency.js";
import { withRetry } from "../../lib/retry.js";
import {
  findAccountForSale,
  findCustomerForSale,
  findSaleById,
  insertSale,
  lockProducts,
  lockStockBalances,
  nextSaleSequence,
  setLocalTimeouts,
  type ReceivedPayment,
  type TxContext,
} from "./sales.repository.js";
import type { CreateSaleDto } from "./sales.schemas.js";
import {
  assertLocationMatchesChannel,
  assertSoldAtNotInFuture,
  assertWithinBounds,
  formatSaleReference,
  MAX_SALE_TOTAL_KOBO,
  normaliseClientReference,
} from "./sales.validation.js";

export const CREATE_SALE_ROUTE = "POST /sales";

/** Neon needs more than Prisma's 5 s default; lock waits fail at 15 s (see repository), before the 20 s timeout. */
const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

export interface SaleResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

export interface SalesServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

/** A stock level so large that the domain's per-line stock check cannot fire (pass 1). */
const UNLIMITED_UNITS = 2_000_000_000;

function syntheticMovement(product: Product, location: CreateSaleDto["location"], units: number): StockMovement {
  return {
    id: `synthetic-${product.id}`,
    productId: product.id,
    location,
    type: "PURCHASE",
    quantityUnits: units,
    unitCostKobo: product.averageCostKobo,
    purchaseLineId: null,
    saleLineId: null,
    transferLegId: null,
    adjustmentLineId: null,
    returnLineId: null,
    reversesEntryId: null,
    occurredAt: new Date(0),
    createdAt: new Date(0),
  };
}

export function createSalesService(options: SalesServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);

  async function createSale(
    dto: CreateSaleDto,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<SaleResponse> {
    // Checks that need no database run first, so a bad request costs nothing.
    const soldAt = new Date(dto.soldAt);
    assertSoldAtNotInFuture(soldAt, now());
    assertLocationMatchesChannel(dto.channel, dto.location);
    assertWithinBounds(dto);
    const clientReference = normaliseClientReference(dto.reference);
    const requestHash = hashRequestBody(dto);

    let attempts = 0;
    const response = await withRetry(
      async () => {
        attempts += 1;
        const startedAt = Date.now();
        const queries = { count: 0 };
        const result = await prisma.$transaction(async (tx) => {
          const ctx: TxContext = { tx, queries };
          return runCreateSale(ctx, dto, actor, soldAt, clientReference, idempotencyKey, requestHash);
        }, TRANSACTION_OPTIONS);
        log({
          route: CREATE_SALE_ROUTE,
          txMs: Date.now() - startedAt,
          queries: queries.count,
          lines: dto.lines.length,
          attempts,
          replayed: result.replayed,
        });
        return result;
      },
      {
        onRetry: (error, attempt) => log({ route: CREATE_SALE_ROUTE, retry: attempt }),
      },
    );
    return response;
  }

  async function runCreateSale(
    ctx: TxContext,
    dto: CreateSaleDto,
    actor: Actor,
    soldAt: Date,
    clientReference: string | null,
    idempotencyKey: string | null,
    requestHash: string,
  ): Promise<SaleResponse> {
    await setLocalTimeouts(ctx);

    let claimId: string | null = null;
    if (idempotencyKey !== null) {
      ctx.queries.count += 2;
      const claim = await claimIdempotencyKey(ctx.tx, {
        key: idempotencyKey,
        route: CREATE_SALE_ROUTE,
        requestHash,
        now: now(),
      });
      if (claim.kind === "replay") {
        return { status: claim.status, body: claim.body, replayed: true };
      }
      claimId = claim.id;
    }

    const productIds = dto.lines.map((line) => line.productId);
    const products = await lockProducts(ctx, productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const productId of new Set(productIds)) {
      const product = productById.get(productId);
      if (product === undefined) {
        throw validationError(`Product '${productId}' does not exist.`, { field: "lines.productId", productId });
      }
      if (product.deletedAt !== null) {
        throw businessRuleError(`Product '${product.name}' is deactivated and cannot be sold.`, {
          productId,
          productName: product.name,
        });
      }
      if (product.saleChannel !== "BOTH" && product.saleChannel !== dto.channel) {
        throw validationError(
          `Product '${product.name}' is only sold ${product.saleChannel.toLowerCase()}, not ${dto.channel.toLowerCase()}.`,
          { productId, productName: product.name, saleChannel: product.saleChannel, channel: dto.channel },
        );
      }
    }

    const balances = await lockStockBalances(ctx, productIds, dto.location);

    if (dto.customerId !== null) {
      const customer = await findCustomerForSale(ctx, dto.customerId);
      if (customer === null) {
        throw validationError("That customer does not exist.", { field: "customerId" });
      }
      if (customer.deletedAt !== null) {
        throw businessRuleError(`Customer '${customer.name}' is deactivated and cannot be sold to.`, {
          customerId: customer.id,
        });
      }
    }

    const paidKobo = BigInt(dto.paidKobo);
    // An account only matters when money is actually received.
    const accountId = paidKobo > 0n ? (dto.accountId ?? null) : null;
    if (accountId !== null) {
      const account = await findAccountForSale(ctx, accountId);
      if (account === null) {
        throw validationError("That account does not exist.", { field: "accountId" });
      }
      if (!account.isActive) {
        throw businessRuleError(`Account '${account.name}' is deactivated and cannot receive money.`, {
          accountId: account.id,
        });
      }
    }

    // One domain pass. Stock is proven below against the locked balances, so the
    // domain's own per-line check is given unlimited stock here and only the
    // remaining validation (quantities, fractions, paid vs total, customer) fires.
    const costByProductId = new Map(products.map((p) => [p.id, p.averageCostKobo]));
    const result = recordSale(
      {
        customerId: dto.customerId,
        customerName: dto.customerName,
        createdById: actor.id,
        channel: dto.channel,
        location: dto.location,
        soldAt,
        notes: dto.notes,
        reference: null,
        paidKobo,
        accountId,
        lines: dto.lines.map((line) => ({
          productId: line.productId,
          unit: line.unit,
          quantity: line.quantity,
          unitPriceKobo: BigInt(line.unitPriceKobo),
        })),
      },
      products,
      products.map((p) => syntheticMovement(p, dto.location, UNLIMITED_UNITS)),
      randomUUID,
    );

    if (result.sale.totalKobo > MAX_SALE_TOTAL_KOBO) {
      throw validationError("The sale total is too large.", { field: "lines" });
    }

    const requestedByProduct = new Map<string, number>();
    for (const movement of result.movements) {
      requestedByProduct.set(
        movement.productId,
        (requestedByProduct.get(movement.productId) ?? 0) - movement.quantityUnits,
      );
    }
    for (const [productId, requested] of [...requestedByProduct].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const available = balances.get(productId) ?? 0;
      if (requested > available) {
        const name = productById.get(productId)?.name ?? productId;
        throw new AppError(
          409,
          "INSUFFICIENT_STOCK",
          `Not enough stock for '${name}' at ${dto.location}: ${available} available, ${requested} requested.`,
          { productId, productName: name, location: dto.location, availableUnits: available, requestedUnits: requested },
        );
      }
    }

    const reference =
      clientReference ?? formatSaleReference(soldAt, await nextSaleSequence(ctx));
    const sale = { ...result.sale, reference };

    const payments: ReceivedPayment[] =
      result.salePayment !== null && result.accountLedgerEntry !== null
        ? [{ payment: result.salePayment, accountEntry: result.accountLedgerEntry }]
        : [];

    const afterData = {
      sale: {
        id: sale.id,
        reference,
        customerId: sale.customerId,
        channel: sale.channel,
        location: dto.location,
        totalKobo: sale.totalKobo.toString(),
        paidKobo: sale.paidKobo.toString(),
        soldAt: sale.soldAt.toISOString(),
      },
      lines: result.saleLines.map((line) => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity,
        quantityUnits: line.quantityUnits,
        unitPriceKobo: line.unitPriceKobo.toString(),
        costPerUnitKobo: (costByProductId.get(line.productId) ?? 0n).toString(),
      })),
      payments: payments.map(({ payment }) => ({
        id: payment.id,
        accountId: payment.accountId,
        amountKobo: payment.amountKobo.toString(),
      })),
    };

    const stored = await insertSale(ctx, {
      sale,
      lines: result.saleLines,
      location: dto.location,
      movements: result.movements,
      customerLedgerEntry: result.customerLedgerEntry,
      payments,
      costByProductId,
      actorId: actor.id,
      audit: {
        afterData,
        metadata: { idempotencyKey, actorEmail: actor.email },
      },
    });

    const body = toSaleDto(stored);
    if (claimId !== null) {
      ctx.queries.count += 1;
      await storeIdempotentResponse(ctx.tx, claimId, 201, body);
    }
    return { status: 201, body, replayed: false };
  }

  async function getSale(id: string): Promise<unknown> {
    const sale = await findSaleById(prisma, id);
    if (sale === null) {
      throw new AppError(404, "NOT_FOUND", "Sale not found.", { id });
    }
    return toSaleDto(sale);
  }

  return { createSale, getSale };
}

export type SalesService = ReturnType<typeof createSalesService>;
